import { useEffect, useRef } from "react";

import type { SessionEntry, SessionInfo } from "@/lib/types";

import styles from "./ChatView.module.css";

type Props = {
  session: SessionInfo;
  entries: SessionEntry[];
};

export function ChatView({ session, entries }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.projectPath} title={session.project_path}>
          {session.project_path}
        </div>
        <div className={styles.meta}>
          <span>{session.model ?? "default model"}</span>
          <span className={styles.dot}>•</span>
          <span className={styles[session.status]}>{session.status}</span>
        </div>
      </div>

      <div ref={scrollRef} className={styles.log}>
        {entries.length === 0 ? (
          <div className={styles.empty}>
            <p>Session ready. Send your first message below.</p>
          </div>
        ) : (
          entries.map((entry, i) => (
            <Entry key={i} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: SessionEntry }) {
  if (entry.kind === "user") {
    return (
      <div className={`${styles.entry} ${styles.userEntry}`}>
        <span className={styles.entryLabel}>you</span>
        <pre className={styles.entryText}>{entry.text}</pre>
      </div>
    );
  }
  if (entry.kind === "system") {
    return (
      <div className={`${styles.entry} ${styles.systemEntry}`}>
        <pre className={styles.entryText}>{entry.text}</pre>
      </div>
    );
  }
  return (
    <div className={`${styles.entry} ${styles.stdoutEntry}`}>
      <pre className={styles.entryText}>{entry.text}</pre>
    </div>
  );
}
