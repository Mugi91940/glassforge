// src/voice-hud/VoiceHud.tsx
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Mic, Circle, Volume2 } from "lucide-react";

import { usePreferencesStore } from "@/stores/preferencesStore";
import { useVoiceStore, type VoicePhase } from "@/stores/voiceStore";
import styles from "./VoiceHud.module.css";

const LABELS: Record<VoicePhase, string> = {
  idle: "En veille",
  listening: "Écoute...",
  processing: "Enregistrement",
  speaking: "Réponse vocale",
};

export function VoiceHud() {
  const phase = useVoiceStore((s) => s.phase);
  const transcript = useVoiceStore((s) => s.transcript);
  const response = useVoiceStore((s) => s.response);
  const setPhase = useVoiceStore((s) => s.setPhase);
  const setTranscript = useVoiceStore((s) => s.setTranscript);
  const setResponse = useVoiceStore((s) => s.setResponse);
  const reset = useVoiceStore((s) => s.reset);

  useEffect(() => {
    void usePreferencesStore.getState().load();
  }, []);

  useEffect(() => {
    const win = getCurrentWebviewWindow();

    const unlisten = listen<{ event: string; text?: string; final?: boolean; message?: string }>(
      "voice://event",
      ({ payload }) => {
        if (payload.event === "transcript") {
          setTranscript(payload.text ?? "");
          if (payload.final) {
            setPhase("processing");
            void handleFinalTranscript(payload.text ?? "");
          } else {
            setPhase("listening");
          }
        } else if (payload.event === "speak_done") {
          const durationMs = usePreferencesStore.getState().voiceHudDuration * 1000;
          setTimeout(() => {
            reset();
            void win.hide();
          }, durationMs);
        } else if (payload.event === "error") {
          setResponse(payload.message ?? "Erreur vocale");
          setPhase("speaking");
        }
      },
    );

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [setPhase, setTranscript, setResponse, reset]);

  return (
    <div className={styles.hud}>
      <div className={styles.icon} data-phase={phase}>
        {phase === "listening" && <Mic size={16} color="rgba(160,140,255,1)" />}
        {phase === "processing" && <Circle size={10} color="rgba(255,100,100,1)" fill="rgba(255,100,100,0.9)" />}
        {phase === "speaking" && <Volume2 size={16} color="rgba(60,220,140,1)" />}
        {phase === "idle" && <Mic size={16} color="rgba(200,200,220,0.3)" />}
      </div>

      <div className={styles.text}>
        <div className={styles.label} data-phase={phase}>
          {LABELS[phase]}
        </div>
        {transcript && (
          <div className={styles.transcript}>{transcript}</div>
        )}
        {response && phase === "speaking" && (
          <div className={styles.response}>{response}</div>
        )}
      </div>

      <div className={styles.shortcut}>Ctrl+Alt+O</div>
    </div>
  );
}

async function handleFinalTranscript(text: string) {
  const { setPhase, setResponse } = useVoiceStore.getState();
  const { voiceLang, voiceAutoSpeak } = usePreferencesStore.getState();

  const command = await invoke<string | null>("voice_detect_command", { text });
  const { emit } = await import("@tauri-apps/api/event");

  if (command) {
    await emit("voice://command", { command });
    const label = commandLabel(command);
    setResponse(label);
    setPhase("speaking");
    if (voiceAutoSpeak) {
      await invoke("voice_speak", { text: label, lang: voiceLang });
    }
  } else {
    await emit("voice://send_message", { text });
    const label = "Message envoyé à Claude";
    setResponse(label);
    setPhase("speaking");
    if (voiceAutoSpeak) {
      await invoke("voice_speak", { text: label, lang: voiceLang });
    }
  }
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
