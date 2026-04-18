import { useEffect } from "react";

import * as log from "@/lib/log";
import { createSession, sendMessage } from "@/lib/tauri-commands";
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

    function voiceCommandHandler(e: Event) {
      const command = (e as CustomEvent<string>).detail;
      switch (command) {
        case "new_session": {
          const lastPath = projects[0]?.path;
          if (lastPath) {
            createSession(lastPath, null)
              .then((info) => {
                addSession(info);
                setActive(info.id);
                void touch(lastPath);
              })
              .catch((err) => log.error("voice new_session failed", String(err)));
          }
          break;
        }
        case "next_session":
          if (order.length > 1) {
            const idx = activeId ? order.indexOf(activeId) : -1;
            setActive(order[idx >= order.length - 1 ? 0 : idx + 1]);
          }
          break;
        case "prev_session":
          if (order.length > 1) {
            const idx = activeId ? order.indexOf(activeId) : -1;
            setActive(order[idx <= 0 ? order.length - 1 : idx - 1]);
          }
          break;
        case "close_session":
          if (activeId) {
            void import("@/lib/tauri-commands").then(({ killSession }) =>
              killSession(activeId),
            );
          }
          break;
        case "copy_response": {
          const lastMsg = document.querySelector(
            "[data-role='assistant']:last-of-type",
          );
          if (lastMsg?.textContent) {
            void navigator.clipboard.writeText(lastMsg.textContent);
          }
          break;
        }
        case "stop_speak":
          void import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("voice_speak", { text: "", lang: "fr" }),
          );
          break;
      }
    }

    function voiceSendMessageHandler(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      if (!activeId) return;
      sendMessage(activeId, text).catch((err) =>
        log.error("voice send_message failed", String(err)),
      );
    }

    window.addEventListener("keydown", handler);
    window.addEventListener("voice:command", voiceCommandHandler);
    window.addEventListener("voice:send_message", voiceSendMessageHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("voice:command", voiceCommandHandler);
      window.removeEventListener("voice:send_message", voiceSendMessageHandler);
    };
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
