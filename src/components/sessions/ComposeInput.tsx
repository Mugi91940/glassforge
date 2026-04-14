import { useRef, useState } from "react";
import { Send } from "lucide-react";

import * as log from "@/lib/log";
import { sendMessage } from "@/lib/tauri-commands";
import { useSessionStore } from "@/stores/sessionStore";

import styles from "./ComposeInput.module.css";

type Props = {
  sessionId: string;
  disabled?: boolean;
};

export function ComposeInput({ sessionId, disabled }: Props) {
  const appendUser = useSessionStore((s) => s.appendUser);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function onSubmit() {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      appendUser(sessionId, message);
      await sendMessage(sessionId, message);
      setText("");
    } catch (e) {
      log.error("send_message failed", e);
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
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
            : "Message Claude — Enter to send, Shift+Enter for newline"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled || busy}
        rows={2}
        spellCheck={false}
      />
      <button
        type="button"
        className={styles.sendButton}
        onClick={() => void onSubmit()}
        disabled={disabled || busy || text.trim().length === 0}
        aria-label="Send message"
      >
        <Send size={14} />
      </button>
    </div>
  );
}
