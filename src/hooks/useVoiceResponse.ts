import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import * as log from "@/lib/log";
import { sendMessage } from "@/lib/tauri-commands";
import type { ChatEntry, ClaudeEvent } from "@/lib/types";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore } from "@/stores/sessionStore";

const MAX_TTS_CHARS = 400;

// Strip markdown noise so TTS doesn't read code, URLs, or backticks aloud.
function prepareForTts(raw: string): string {
  let clean = raw.replace(/```[\s\S]*?```/g, " ");
  clean = clean.replace(/`[^`]+`/g, "");
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  clean = clean.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_TTS_CHARS) return clean;
  const truncated = clean.slice(0, MAX_TTS_CHARS);
  const lastStop = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("? "),
    truncated.lastIndexOf("! "),
  );
  return lastStop > 200 ? truncated.slice(0, lastStop + 1) : truncated + "...";
}

function findLastAssistantText(entries: ChatEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "assistant" && e.text.trim()) return e.text;
  }
  return null;
}

// Orchestrates voice-dictated messages: sends to Claude, waits for the
// turn to complete, then TTSes the assistant's reply back to the HUD.
export function useVoiceResponse(): void {
  const pendingRef = useRef<string | null>(null);
  const order = useSessionStore((s) => s.order);
  const activeId = useSessionStore((s) => s.activeId);

  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    function voiceSendHandler(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      const sid = activeIdRef.current;
      if (!sid) {
        log.warn("voice send_message ignored: no active session");
        return;
      }
      pendingRef.current = sid;
      sendMessage(sid, text).catch((err) => {
        log.error("voice send_message failed", String(err));
        pendingRef.current = null;
      });
    }
    window.addEventListener("voice:send_message", voiceSendHandler);
    return () =>
      window.removeEventListener("voice:send_message", voiceSendHandler);
  }, []);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    (async () => {
      for (const sid of order) {
        const u = await listen<ClaudeEvent>(
          `session://${sid}/event`,
          ({ payload }) => {
            if (payload.type !== "result") return;
            if (pendingRef.current !== sid) return;
            pendingRef.current = null;

            const entries = useSessionStore.getState().entries[sid] ?? [];
            const lastText = findLastAssistantText(entries);
            if (!lastText) return;

            const { voiceAutoSpeak, voiceLang } =
              usePreferencesStore.getState();
            if (!voiceAutoSpeak) return;

            const spoken = prepareForTts(lastText);
            if (!spoken) return;

            void emit("voice://response", { text: spoken });
            invoke("voice_speak", { text: spoken, lang: voiceLang }).catch(
              (err) => log.warn("voice_speak failed", err),
            );
          },
        );
        if (cancelled) {
          u();
          continue;
        }
        unlisteners.push(u);
      }
    })().catch((err) =>
      log.error("voice response listener attach failed", String(err)),
    );

    return () => {
      cancelled = true;
      for (const u of unlisteners) {
        try {
          u();
        } catch (err) {
          log.warn("failed to unlisten voice response", err);
        }
      }
    };
  }, [order]);
}
