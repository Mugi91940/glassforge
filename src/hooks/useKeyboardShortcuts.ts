import { useEffect } from "react";

import * as log from "@/lib/log";
import { createSession } from "@/lib/tauri-commands";
import { useProjectHistoryStore } from "@/stores/projectHistoryStore";
import { useSessionStore } from "@/stores/sessionStore";

type Options = {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
};

export function useKeyboardShortcuts({
  settingsOpen,
  setSettingsOpen,
}: Options) {
  const order = useSessionStore((s) => s.order);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const addSession = useSessionStore((s) => s.addSession);
  const projects = useProjectHistoryStore((s) => s.projects);
  const touch = useProjectHistoryStore((s) => s.touch);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Escape — close settings if open
      if (e.key === "Escape") {
        if (settingsOpen) {
          e.preventDefault();
          setSettingsOpen(false);
        }
        return;
      }

      if (!ctrl) return;

      // Ctrl+, — toggle settings
      if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(!settingsOpen);
        return;
      }

      // Ctrl+N — new session from most recent project, or focus input
      if (e.key === "n") {
        e.preventDefault();
        const lastPath = projects[0]?.path;
        if (lastPath) {
          createSession(lastPath, null)
            .then((info) => {
              addSession(info);
              setActive(info.id);
              void touch(lastPath);
            })
            .catch((err) =>
              log.error("Ctrl+N create_session failed", String(err)),
            );
        } else {
          document.getElementById("project-path")?.focus();
        }
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle sessions
      if (e.key === "Tab" && order.length > 1) {
        e.preventDefault();
        const currentIdx = activeId ? order.indexOf(activeId) : -1;
        let nextIdx: number;
        if (e.shiftKey) {
          nextIdx = currentIdx <= 0 ? order.length - 1 : currentIdx - 1;
        } else {
          nextIdx = currentIdx >= order.length - 1 ? 0 : currentIdx + 1;
        }
        setActive(order[nextIdx]);
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    settingsOpen,
    setSettingsOpen,
    order,
    activeId,
    setActive,
    addSession,
    projects,
    touch,
  ]);
}
