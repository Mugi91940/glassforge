import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import * as log from "@/lib/log";
import type {
  ExitPayload,
  SessionStatus,
  StdoutChunkPayload,
} from "@/lib/types";
import { useSessionStore } from "@/stores/sessionStore";

// Subscribes the sessionStore to Tauri events for every known session.
// Re-runs whenever the set of session ids changes, tearing down old
// listeners and installing fresh ones in lockstep.
export function useSessionEvents(): void {
  const order = useSessionStore((s) => s.order);
  const appendStdout = useSessionStore((s) => s.appendStdout);
  const updateStatus = useSessionStore((s) => s.updateStatus);
  const appendSystem = useSessionStore((s) => s.appendSystem);
  const removeSession = useSessionStore((s) => s.removeSession);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    async function attach() {
      for (const id of order) {
        const stdoutEvent = `session://${id}/stdout`;
        const statusEvent = `session://${id}/status`;
        const exitEvent = `session://${id}/exit`;

        const u1 = await listen<StdoutChunkPayload>(stdoutEvent, (e) => {
          appendStdout(id, e.payload.data);
        });
        const u2 = await listen<SessionStatus>(statusEvent, (e) => {
          updateStatus(id, e.payload);
        });
        const u3 = await listen<ExitPayload>(exitEvent, (e) => {
          const code = e.payload.code;
          appendSystem(
            id,
            `\n[session exited${code !== null ? ` with code ${code}` : ""}]\n`,
          );
          // Keep the session on screen for a moment so the user can see the
          // final output, then drop it from the registry on the UI side.
          setTimeout(() => {
            if (!cancelled) removeSession(id);
          }, 1500);
        });

        if (cancelled) {
          u1();
          u2();
          u3();
          return;
        }
        unlisteners.push(u1, u2, u3);
      }
    }

    attach().catch((e) => log.error("session listener attach failed", e));

    return () => {
      cancelled = true;
      for (const fn of unlisteners) {
        try {
          fn();
        } catch (e) {
          log.warn("failed to unlisten", e);
        }
      }
    };
  }, [order, appendStdout, updateStatus, appendSystem, removeSession]);
}
