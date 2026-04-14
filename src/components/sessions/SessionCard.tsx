import { X } from "lucide-react";

import * as log from "@/lib/log";
import { killSession } from "@/lib/tauri-commands";
import type { SessionInfo } from "@/lib/types";

import styles from "./SessionCard.module.css";

type Props = {
  session: SessionInfo;
  active: boolean;
  onSelect: () => void;
};

export function SessionCard({ session, active, onSelect }: Props) {
  const projectName =
    session.project_path.split("/").filter(Boolean).pop() ??
    session.project_path;

  async function onKill(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await killSession(session.id);
    } catch (err) {
      log.error("kill_session failed", err);
    }
  }

  return (
    <button
      type="button"
      className={`${styles.card} ${active ? styles.active : ""}`}
      onClick={onSelect}
    >
      <div className={styles.header}>
        <span className={`${styles.dot} ${styles[session.status]}`} />
        <span className={styles.name} title={session.project_path}>
          {projectName}
        </span>
        <span
          className={styles.kill}
          role="button"
          tabIndex={-1}
          aria-label="Kill session"
          onClick={onKill}
        >
          <X size={12} />
        </span>
      </div>
      <div className={styles.meta}>
        <span className={styles.model}>{session.model ?? "default"}</span>
        <span className={styles.status}>{session.status}</span>
      </div>
    </button>
  );
}
