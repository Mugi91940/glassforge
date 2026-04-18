// src/voice-hud/VoiceHud.tsx
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { Mic, Circle, Volume2 } from "lucide-react";

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
          setTimeout(() => {
            reset();
            void win.hide();
          }, 3000);
        }
      },
    );

    const unlistenToggle = listen("voice://toggle", async () => {
      const isListening = await invoke<boolean>("voice_is_listening");
      if (isListening) {
        await invoke("voice_stop_listen");
        setPhase("idle");
      } else {
        await positionTopCenter(win);
        await win.show();
        await win.setFocus();
        await invoke("voice_start_listen");
        setPhase("listening");
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
      void unlistenToggle.then((fn) => fn());
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

      <div className={styles.shortcut}>Super+V</div>
    </div>
  );
}

async function positionTopCenter(win: ReturnType<typeof getCurrentWebviewWindow>) {
  try {
    const monitor = await currentMonitor();
    if (!monitor) return;
    const screenW = monitor.size.width;
    const windowW = 440;
    const x = Math.floor((screenW - windowW) / 2);
    await win.setPosition({ type: "Physical", x, y: 20 } as never);
  } catch {
    // ignore positioning errors
  }
}

async function handleFinalTranscript(text: string) {
  const { setPhase, setResponse } = useVoiceStore.getState();

  const command = await invoke<string | null>("voice_detect_command", { text });
  if (command) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("voice://command", { command });
    const label = commandLabel(command);
    setResponse(label);
    setPhase("speaking");
    await invoke("voice_speak", { text: label, lang: "fr" });
  } else {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("voice://send_message", { text });
    setResponse("Message envoyé à Claude");
    setPhase("speaking");
    await invoke("voice_speak", { text: "Message envoyé à Claude", lang: "fr" });
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
