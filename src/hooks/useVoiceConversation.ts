import { useEffect } from "react";
import { emit } from "@tauri-apps/api/event";

import type { ChatEntry } from "@/lib/types";
import { useSessionStore } from "@/stores/sessionStore";

const MAX_PREVIEW_ENTRIES = 6;
const MAX_PREVIEW_CHARS = 200;

type VoiceConvEntry = { role: "user" | "assistant"; text: string };

function pickPreview(entries: ChatEntry[]): VoiceConvEntry[] {
  const out: VoiceConvEntry[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < MAX_PREVIEW_ENTRIES; i--) {
    const e = entries[i];
    if (e.kind === "user" && e.text.trim()) {
      out.push({ role: "user", text: truncate(e.text) });
    } else if (e.kind === "assistant" && e.text.trim()) {
      out.push({ role: "assistant", text: truncate(e.text) });
    }
  }
  return out.reverse();
}

function truncate(s: string): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > MAX_PREVIEW_CHARS
    ? clean.slice(0, MAX_PREVIEW_CHARS) + "..."
    : clean;
}

// Pushes a compact version of the active session's chat into the voice HUD
// so the user can glance at recent context while dictating.
export function useVoiceConversation(): void {
  const activeId = useSessionStore((s) => s.activeId);
  const entries = useSessionStore((s) =>
    s.activeId ? s.entries[s.activeId] : undefined,
  );

  useEffect(() => {
    const preview = activeId && entries ? pickPreview(entries) : [];
    void emit("voice://conversation", {
      entries: preview,
      sessionId: activeId ?? null,
    });
  }, [activeId, entries]);
}
