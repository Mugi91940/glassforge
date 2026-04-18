// src/voice-hud/VoiceHud.tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  AlertTriangle,
  Check,
  Circle,
  Mic,
  Send,
  Shield,
  Volume2,
  X,
} from "lucide-react";

import type { PermissionDecision } from "@/lib/tauri-commands";
import { usePreferencesStore } from "@/stores/preferencesStore";
import {
  useVoiceStore,
  type ConversationEntry,
  type VoicePhase,
} from "@/stores/voiceStore";
import styles from "./VoiceHud.module.css";

type PendingPerm = {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
} | null;

const LABELS: Record<VoicePhase, string> = {
  idle: "En veille",
  listening: "Écoute...",
  editing: "Corriger et envoyer",
  processing: "Envoi à Claude...",
  speaking: "Réponse",
};

export function VoiceHud() {
  const phase = useVoiceStore((s) => s.phase);
  const transcript = useVoiceStore((s) => s.transcript);
  const draft = useVoiceStore((s) => s.draft);
  const response = useVoiceStore((s) => s.response);
  const conversation = useVoiceStore((s) => s.conversation);
  const setPhase = useVoiceStore((s) => s.setPhase);
  const setTranscript = useVoiceStore((s) => s.setTranscript);
  const setDraft = useVoiceStore((s) => s.setDraft);
  const setResponse = useVoiceStore((s) => s.setResponse);
  const setConversation = useVoiceStore((s) => s.setConversation);
  const reset = useVoiceStore((s) => s.reset);

  const phaseRef = useRef(phase);
  const draftRef = useRef(draft);
  // Tracks whether the user has manually edited the draft this turn.
  // If true, an incoming final transcript won't clobber their edits.
  const userEditedRef = useRef(false);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const convScrollRef = useRef<HTMLDivElement | null>(null);

  const [pendingPerm, setPendingPerm] = useState<PendingPerm>(null);

  useEffect(() => {
    void usePreferencesStore.getState().load();
  }, []);

  // Auto-scroll conversation preview to the most recent message.
  useEffect(() => {
    if (convScrollRef.current) {
      convScrollRef.current.scrollTop = convScrollRef.current.scrollHeight;
    }
  }, [conversation]);

  // Focus the input when transitioning to editing.
  useEffect(() => {
    if (phase === "editing" && inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [phase]);

  useEffect(() => {
    const unlistenEvent = listen<{
      event: string;
      text?: string;
      final?: boolean;
      message?: string;
    }>("voice://event", ({ payload }) => {
      if (payload.event === "transcript") {
        const text = payload.text ?? "";
        setTranscript(text);
        if (payload.final) {
          // Only override the draft if the user hasn't started editing
          // since they hit stop — otherwise we'd clobber their fixes.
          if (!userEditedRef.current) setDraft(text);
          if (phaseRef.current !== "editing") setPhase("editing");
        } else {
          const p = phaseRef.current;
          if (p === "idle" || p === "listening") {
            if (!userEditedRef.current) setDraft(text);
            if (p !== "listening") setPhase("listening");
          }
        }
      } else if (payload.event === "speak_done") {
        // Don't auto-hide — the user wants the HUD to stay until they
        // dismiss it. Just reset to idle so the next shortcut press
        // starts a fresh listening turn.
        setPhase("idle");
        setResponse("");
      } else if (payload.event === "error") {
        setResponse(payload.message ?? "Erreur vocale");
        setPhase("speaking");
      }
    });

    const unlistenResponse = listen<{ text: string }>(
      "voice://response",
      ({ payload }) => {
        setResponse(payload.text);
        setPhase("speaking");
      },
    );

    const unlistenConv = listen<{ entries: ConversationEntry[] }>(
      "voice://conversation",
      ({ payload }) => {
        setConversation(payload.entries);
      },
    );

    const unlistenPerm = listen<PendingPerm>(
      "voice://permission",
      ({ payload }) => {
        setPendingPerm(payload);
      },
    );

    const unlistenOpened = listen("voice://opened", () => {
      reset();
      userEditedRef.current = false;
      setPhase("listening");
    });

    // main.tsx forwards the shortcut as voice://toggle-visible when the
    // HUD is already on screen. Listening only to this variant (and not
    // the raw voice://toggle) prevents a race where this handler fires
    // right after main.tsx calls hud.show() and immediately dismisses it.
    const unlistenToggle = listen("voice://toggle-visible", async () => {
      const p = phaseRef.current;
      if (p === "listening") {
        // Instant UX: flip to editing *now* using the latest draft so
        // the user sees the transition immediately. The sidecar's final
        // transcript may arrive a moment later and refine the draft
        // (unless the user has already started editing).
        await invoke("voice_stop_listen").catch(() => {});
        setPhase("editing");
      } else if (p === "editing") {
        await submitDraft(draftRef.current);
      } else if (p === "idle" || p === "speaking") {
        // Start a fresh listening turn. For "speaking", this cuts the
        // wait — user can dictate the next message while the reply TTS
        // finishes in the background.
        userEditedRef.current = false;
        reset();
        setPhase("listening");
        const { voiceLang } = usePreferencesStore.getState();
        await invoke("voice_start_listen", { lang: voiceLang }).catch(
          () => {},
        );
      }
      // processing: intentionally a no-op — don't interrupt Claude.
    });

    return () => {
      void unlistenEvent.then((fn) => fn());
      void unlistenResponse.then((fn) => fn());
      void unlistenConv.then((fn) => fn());
      void unlistenPerm.then((fn) => fn());
      void unlistenOpened.then((fn) => fn());
      void unlistenToggle.then((fn) => fn());
    };
  }, [setPhase, setTranscript, setDraft, setResponse, setConversation, reset]);

  const decidePermission = async (decision: PermissionDecision) => {
    if (!pendingPerm) return;
    const { sessionId, requestId } = pendingPerm;
    // Clear locally first so the panel disappears immediately, even
    // before the main window's store update round-trips.
    setPendingPerm(null);
    try {
      await invoke("resolve_permission", { sessionId, requestId, decision });
    } catch (e) {
      console.warn("resolve_permission failed", e);
    }
    await emit("voice://permission_resolved", {
      sessionId,
      requestId,
      decision,
    });
  };

  const handleSend = () => {
    void submitDraft(draftRef.current);
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    userEditedRef.current = true;
    setDraft(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      e.preventDefault();
      void closeHud();
    }
  };

  const handleClose = () => {
    void closeHud();
  };

  const canEdit = phase === "editing";
  const displayValue = canEdit ? draft : transcript;

  return (
    <div className={styles.hud}>
      <div className={styles.titleBar} data-tauri-drag-region>
        <span className={styles.titleLabel} data-tauri-drag-region>
          GlassForge Voice
        </span>
        <button
          type="button"
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Fermer"
          title="Fermer (Échap)"
        >
          <X size={12} />
        </button>
      </div>
      {pendingPerm ? (
        <div className={styles.permissionPanel}>
          <div className={styles.permissionHeader}>
            <AlertTriangle size={14} className={styles.permissionWarn} />
            <span className={styles.permissionTitle}>Permission requise</span>
          </div>
          <div className={styles.permissionTool}>
            <span className={styles.permissionLabel}>Outil</span>
            <span className={styles.permissionToolName}>
              {pendingPerm.toolName}
            </span>
          </div>
          <div className={styles.permissionActions}>
            <button
              type="button"
              className={`${styles.permButton} ${styles.permDeny}`}
              onClick={() => void decidePermission("deny")}
            >
              <X size={12} />
              <span>Refuser</span>
            </button>
            <button
              type="button"
              className={`${styles.permButton} ${styles.permSession}`}
              onClick={() => void decidePermission("allowSession")}
              title="Autoriser pour toute la session"
            >
              <Shield size={12} />
              <span>Session</span>
            </button>
            <button
              type="button"
              className={`${styles.permButton} ${styles.permAllow}`}
              onClick={() => void decidePermission("allow")}
            >
              <Check size={12} />
              <span>Autoriser</span>
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.conversation} ref={convScrollRef}>
          {conversation.length === 0 ? (
            <div className={styles.convEmpty}>Aucune conversation active</div>
          ) : (
            conversation.map((entry, i) => (
              <div
                key={i}
                className={styles.convLine}
                data-role={entry.role}
              >
                <span className={styles.convRole}>
                  {entry.role === "user" ? "Vous" : "Claude"}
                </span>
                <span className={styles.convText}>{entry.text}</span>
              </div>
            ))
          )}
          {phase === "processing" && (
            <div className={styles.convLine} data-role="assistant">
              <span className={styles.convRole}>Claude</span>
              <span className={styles.thinkingBubble}>
                <span className={styles.thinkingDot} />
                <span className={styles.thinkingDot} />
                <span className={styles.thinkingDot} />
              </span>
            </div>
          )}
        </div>
      )}

      <div className={styles.inputRow}>
        <div className={styles.icon} data-phase={phase}>
          {phase === "listening" && (
            <Mic size={16} color="rgba(160,140,255,1)" />
          )}
          {phase === "editing" && (
            <Mic size={16} color="rgba(255,180,60,1)" />
          )}
          {phase === "processing" && (
            <Circle
              size={10}
              color="rgba(255,100,100,1)"
              fill="rgba(255,100,100,0.9)"
            />
          )}
          {phase === "speaking" && (
            <Volume2 size={16} color="rgba(60,220,140,1)" />
          )}
          {phase === "idle" && (
            <Mic size={16} color="rgba(200,200,220,0.3)" />
          )}
        </div>

        <textarea
          ref={inputRef}
          className={styles.input}
          value={displayValue}
          readOnly={!canEdit}
          placeholder={
            phase === "listening" ? "Parlez..." : "Parlez puis corrigez..."
          }
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          rows={3}
        />

        <button
          type="button"
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!canEdit || !draft.trim()}
          aria-label="Envoyer"
        >
          <Send size={14} />
        </button>
      </div>

      <div className={styles.statusRow}>
        <span className={styles.label} data-phase={phase}>
          {LABELS[phase]}
        </span>
        {phase === "speaking" && response && (
          <span className={styles.response}>{response}</span>
        )}
        <span className={styles.shortcut}>Ctrl+Alt+O</span>
      </div>
    </div>
  );
}

async function closeHud() {
  const win = getCurrentWebviewWindow();
  // Stop any in-flight listening so the sidecar doesn't keep recording
  // in the background after the user closes the HUD.
  await invoke("voice_stop_listen").catch(() => {});
  useVoiceStore.getState().reset();
  await win.hide();
}

async function submitDraft(text: string) {
  const clean = text.trim();
  if (!clean) return;
  const { setPhase, setResponse } = useVoiceStore.getState();

  const command = await invoke<string | null>("voice_detect_command", {
    text: clean,
  });
  if (command) {
    await emit("voice://command", { command });
    const label = commandLabel(command);
    setResponse(label);
    setPhase("speaking");
    const { voiceLang, voiceAutoSpeak, voiceVolume } =
      usePreferencesStore.getState();
    if (voiceAutoSpeak) {
      await invoke("voice_speak", {
        text: label,
        lang: voiceLang,
        volume: voiceVolume,
      });
    }
    return;
  }

  await emit("voice://send_message", { text: clean });
  setResponse("En attente de la réponse...");
  setPhase("processing");
}

function commandLabel(cmd: string): string {
  const labels: Record<string, string> = {
    new_session: "Nouvelle session créée.",
    close_session: "Session fermée.",
    next_session: "Session suivante.",
    prev_session: "Session précédente.",
    copy_response: "Réponse copiée.",
    stop_speak: "Arrêt de la lecture.",
  };
  return labels[cmd] ?? "Commande exécutée.";
}
