// src/voice-hud/VoiceHud.tsx
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Mic, Circle, Volume2, Send } from "lucide-react";

import { usePreferencesStore } from "@/stores/preferencesStore";
import {
  useVoiceStore,
  type ConversationEntry,
  type VoicePhase,
} from "@/stores/voiceStore";
import styles from "./VoiceHud.module.css";

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
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const convScrollRef = useRef<HTMLDivElement | null>(null);

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
    const win = getCurrentWebviewWindow();

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
          // Stop-listen was triggered → fill the editable draft with the
          // final transcript so the user can tweak it before sending.
          setDraft(text);
          setPhase("editing");
        } else {
          // Live partial — mirror into the draft and ensure we're in the
          // listening phase so the UI reflects it.
          const p = phaseRef.current;
          if (p === "idle" || p === "listening") {
            setDraft(text);
            if (p !== "listening") setPhase("listening");
          }
        }
      } else if (payload.event === "speak_done") {
        const durationMs =
          usePreferencesStore.getState().voiceHudDuration * 1000;
        setTimeout(() => {
          reset();
          void win.hide();
        }, durationMs);
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

    const unlistenOpened = listen("voice://opened", () => {
      reset();
      setPhase("listening");
    });

    // Owning the toggle only when HUD is visible lets main.tsx own the
    // open-from-hidden case. Checking phase here gives "send on 3rd press".
    const unlistenToggle = listen("voice://toggle", async () => {
      if (!(await win.isVisible())) return;
      const p = phaseRef.current;
      if (p === "listening") {
        await invoke("voice_stop_listen").catch(() => {});
        // Phase flip to "editing" happens when the final transcript lands.
      } else if (p === "editing") {
        await submitDraft(draftRef.current);
      } else {
        await win.hide();
      }
    });

    return () => {
      void unlistenEvent.then((fn) => fn());
      void unlistenResponse.then((fn) => fn());
      void unlistenConv.then((fn) => fn());
      void unlistenOpened.then((fn) => fn());
      void unlistenToggle.then((fn) => fn());
    };
  }, [setPhase, setTranscript, setDraft, setResponse, setConversation, reset]);

  const handleSend = () => {
    void submitDraft(draftRef.current);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      e.preventDefault();
      void getCurrentWebviewWindow().hide();
    }
  };

  const canEdit = phase === "editing";
  const displayValue = canEdit ? draft : transcript;

  return (
    <div className={styles.hud}>
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
      </div>

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
          onChange={(e) => setDraft(e.target.value)}
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
