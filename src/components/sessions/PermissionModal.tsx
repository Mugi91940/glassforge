import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Shield, X } from "lucide-react";

import * as log from "@/lib/log";
import {
  resolvePermission,
  type PermissionDecision,
} from "@/lib/tauri-commands";
import { useSessionStore } from "@/stores/sessionStore";

import styles from "./PermissionModal.module.css";

type Props = {
  sessionId: string;
};

function stringifyInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function PermissionModal({ sessionId }: Props) {
  const pending = useSessionStore(
    (s) => s.pendingPermissions[sessionId]?.[0] ?? null,
  );
  const markResolved = useSessionStore((s) => s.resolvePermission);
  const clearAll = useSessionStore((s) => s.clearPermissions);

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        void decide("deny");
      } else if (e.key === "Enter") {
        e.preventDefault();
        void decide("allow");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;

  async function decide(decision: PermissionDecision) {
    if (!pending) return;
    try {
      await resolvePermission(sessionId, pending.requestId, decision);
    } catch (e) {
      log.warn("resolve_permission failed", e);
    } finally {
      if (decision === "allowSession") {
        // The Rust broker drains every parked request for this session,
        // so the frontend needs to mirror that and drop the whole queue.
        clearAll(sessionId);
      } else {
        markResolved(sessionId, pending.requestId);
      }
    }
  }

  const inputText = stringifyInput(pending.toolInput);

  return createPortal(
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Tool permission request"
      >
        <header className={styles.header}>
          <AlertTriangle size={16} className={styles.warnIcon} />
          <h2 className={styles.title}>Allow this tool call?</h2>
        </header>

        <div className={styles.body}>
          <div className={styles.row}>
            <span className={styles.label}>Tool</span>
            <span className={styles.toolName}>{pending.toolName}</span>
          </div>
          {inputText ? (
            <div className={styles.inputBlock}>
              <span className={styles.label}>Input</span>
              <pre className={styles.inputPre}>{inputText}</pre>
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={`${styles.button} ${styles.deny}`}
            onClick={() => void decide("deny")}
          >
            <X size={13} />
            <span>Deny</span>
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.allowSession}`}
            onClick={() => void decide("allowSession")}
            title="Allow this and every subsequent call until you close the session"
          >
            <Shield size={13} />
            <span>Allow session</span>
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.allow}`}
            onClick={() => void decide("allow")}
          >
            <Check size={13} />
            <span>Allow once</span>
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
