import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import * as log from "@/lib/log";
import type { PermissionDecision } from "@/lib/tauri-commands";
import { useSessionStore } from "@/stores/sessionStore";

export type VoicePermissionPayload = {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
} | null;

// Bridges Claude's pending tool-permission requests into the voice HUD.
// When the active session has a pending request we push it to the HUD
// via voice://permission; when the HUD (or the main-window modal)
// resolves it, we listen on voice://permission_resolved and keep the
// local store in sync so the modal closes too.
export function useVoicePermission(): void {
  const activeId = useSessionStore((s) => s.activeId);
  const pending = useSessionStore((s) =>
    s.activeId ? (s.pendingPermissions[s.activeId]?.[0] ?? null) : null,
  );

  useEffect(() => {
    const payload: VoicePermissionPayload =
      activeId && pending
        ? {
            sessionId: activeId,
            requestId: pending.requestId,
            toolName: pending.toolName,
            toolInput: pending.toolInput,
          }
        : null;
    void emit("voice://permission", payload);
  }, [activeId, pending]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<{
        sessionId: string;
        requestId: string;
        decision: PermissionDecision;
      }>("voice://permission_resolved", ({ payload }) => {
        const store = useSessionStore.getState();
        if (payload.decision === "allowSession") {
          store.clearPermissions(payload.sessionId);
        } else {
          store.resolvePermission(payload.sessionId, payload.requestId);
        }
      });
    })().catch((e) =>
      log.warn("voice permission_resolved listener failed", e),
    );
    return () => {
      unlisten?.();
    };
  }, []);
}
