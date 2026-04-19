import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import * as log from "@/lib/log";
import { sendMessage } from "@/lib/tauri-commands";
import type { ChatEntry, ClaudeEvent } from "@/lib/types";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore } from "@/stores/sessionStore";

// Extract the "important info" from Claude's reply for TTS.
// No character limit — but we stop at structural boundaries that mean
// "the prose ended and the details begin": lists, code blocks, second
// paragraphs. That way piper reads the full intro/answer sentence(s)
// without trying to speak enumerated bullets or code.
function extractGist(raw: string): string {
  // Strip code blocks and inline code — unreadable by TTS.
  let clean = raw.replace(/```[\s\S]*?```/g, "\n\n");
  clean = clean.replace(/`[^`]+`/g, "");
  // Strip markdown link syntax (keep the visible text).
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Strip headings, bold, italic, stray asterisks.
  clean = clean.replace(/#{1,6}\s+/g, "");
  clean = clean.replace(/\*\*([^*]+)\*\*/g, "$1");
  clean = clean.replace(/\*([^*]+)\*/g, "$1");
  clean = clean.replace(/\*/g, "");

  // Take everything up to the first of:
  //   - a blank line (paragraph break)
  //   - a list marker at start of line (-, *, •, 1., 2., etc.)
  // This is where Claude's prose tends to hand off to structure.
  const lines = clean.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Blank line after we've collected content ends the paragraph.
      if (kept.length > 0) break;
      continue;
    }
    if (/^(?:[-*•]|\d+[.)])\s+/.test(trimmed)) {
      // A list item — stop before it.
      break;
    }
    kept.push(trimmed);
  }

  return kept.join(" ").replace(/\s+/g, " ").trim();
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
  // Per-session counter. Incremented on each voice send, decremented on
  // each matching `result` event. A counter (not a flag) is required so
  // rapid-fire voice sends (send msg 2 before msg 1's result arrives)
  // don't lose the TTS for later turns: the simple flag was being
  // cleared by msg 1's result and then "pending" looked false when
  // msg 2's result landed.
  const pendingCountRef = useRef<Record<string, number>>({});
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
      pendingCountRef.current[sid] =
        (pendingCountRef.current[sid] ?? 0) + 1;
      sendMessage(sid, text).catch((err) => {
        log.error("voice send_message failed", String(err));
        pendingCountRef.current[sid] = Math.max(
          0,
          (pendingCountRef.current[sid] ?? 0) - 1,
        );
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
            const count = pendingCountRef.current[sid] ?? 0;
            if (count <= 0) return;
            pendingCountRef.current[sid] = count - 1;

            const entries = useSessionStore.getState().entries[sid] ?? [];
            const lastText = findLastAssistantText(entries);
            if (!lastText) return;

            const { voiceAutoSpeak, voiceLang, voiceVolume } =
              usePreferencesStore.getState();
            if (!voiceAutoSpeak) return;

            const spoken = extractGist(lastText);
            if (!spoken) return;

            void emit("voice://response", { text: spoken });
            invoke("voice_speak", {
              text: spoken,
              lang: voiceLang,
              volume: voiceVolume,
            }).catch((err) => log.warn("voice_speak failed", err));
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
