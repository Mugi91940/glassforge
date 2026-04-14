import { useRef, useState } from "react";
import { Send, Square } from "lucide-react";

import * as log from "@/lib/log";
import { killSession, sendMessage } from "@/lib/tauri-commands";
import type { ChatEntry } from "@/lib/types";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore } from "@/stores/sessionStore";

import styles from "./ComposeInput.module.css";

type Props = {
  sessionId: string;
  disabled?: boolean;
};

const SLASH_HELP = `/clear — wipe the local transcript (claude session is untouched)
/model <opus|sonnet|haiku|default> — switch model for this session
/compact — ask claude to summarize the conversation
/help — show this list`;

export function ComposeInput({ sessionId, disabled }: Props) {
  const model = useSessionStore(
    (s) => s.sessions[sessionId]?.model ?? null,
  );
  const isRunning = useSessionStore(
    (s) => s.sessions[sessionId]?.status === "running",
  );
  const permissionMode = usePreferencesStore((s) => s.permissionMode);
  const updateSession = useSessionStore((s) => s.updateSession);
  const seedEntries = useSessionStore((s) => s.seedEntries);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function pushSystem(text: string) {
    const prev = useSessionStore.getState().entries[sessionId] ?? [];
    const next: ChatEntry[] = [
      ...prev,
      { kind: "system", ts: Date.now(), text },
    ];
    seedEntries(sessionId, next);
  }

  /** Returns true if the input was handled locally and sendMessage should
   *  be skipped. */
  function handleSlashCommand(raw: string): boolean {
    if (!raw.startsWith("/")) return false;
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();

    switch (cmd) {
      case "clear": {
        seedEntries(sessionId, []);
        return true;
      }
      case "model": {
        const normalized = arg.toLowerCase();
        const valid = new Set(["opus", "sonnet", "haiku", "default", ""]);
        if (!valid.has(normalized)) {
          pushSystem(
            `/model: unknown '${arg}'. Accepted: opus, sonnet, haiku, default.`,
          );
          return true;
        }
        const nextModel =
          normalized === "" || normalized === "default" ? null : normalized;
        updateSession(sessionId, { model: nextModel });
        pushSystem(
          `Model set to ${nextModel ?? "default"} for this session.`,
        );
        return true;
      }
      case "compact": {
        // Forward a summarize prompt — claude will reply with a
        // compact digest which the user can then refer to.
        void (async () => {
          setBusy(true);
          try {
            await sendMessage(
              sessionId,
              "Summarize our conversation so far as concisely as possible, preserving all decisions, file paths, and pending TODOs. Return just the summary.",
              model,
              permissionMode,
            );
          } catch (e) {
            log.error("compact send failed", e);
          } finally {
            setBusy(false);
            textareaRef.current?.focus();
          }
        })();
        return true;
      }
      case "help": {
        pushSystem(SLASH_HELP);
        return true;
      }
      default:
        return false;
    }
  }

  async function onSubmit() {
    const message = text.trim();
    if (!message || busy || isRunning) return;

    if (handleSlashCommand(message)) {
      setText("");
      textareaRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      await sendMessage(sessionId, message, model, permissionMode);
      setText("");
    } catch (e) {
      log.error("send_message failed", e);
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  async function onCancel() {
    try {
      await killSession(sessionId);
    } catch (e) {
      log.error("kill_session failed", e);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSubmit();
    }
  }

  return (
    <div className={styles.root}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        placeholder={
          disabled
            ? "Session is not ready."
            : isRunning
              ? "Claude is replying — wait or cancel to send again."
              : "Message Claude — Enter to send, Shift+Enter for newline"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled || busy || isRunning}
        rows={2}
        spellCheck={false}
      />
      {isRunning ? (
        <button
          type="button"
          className={`${styles.sendButton} ${styles.cancelButton}`}
          onClick={() => void onCancel()}
          aria-label="Cancel current reply"
        >
          <Square size={12} />
        </button>
      ) : (
        <button
          type="button"
          className={styles.sendButton}
          onClick={() => void onSubmit()}
          disabled={disabled || busy || text.trim().length === 0}
          aria-label="Send message"
        >
          <Send size={14} />
        </button>
      )}
    </div>
  );
}
