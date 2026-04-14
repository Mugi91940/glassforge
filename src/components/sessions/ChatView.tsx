import { useEffect, useMemo, useRef } from "react";

import {
  estimateTokens,
  formatCost,
  formatTokens,
  resolvePricing,
  estimateCostUsd,
} from "@/lib/pricing";
import type { SessionEntry, SessionInfo } from "@/lib/types";
import { useSessionStore, type SessionUsage } from "@/stores/sessionStore";

import { ContextRing } from "@/components/stats/ContextRing";

import styles from "./ChatView.module.css";

type Props = {
  session: SessionInfo;
  entries: SessionEntry[];
};

export function ChatView({ session, entries }: Props) {
  const usage = useSessionStore(
    (s) => s.usage[session.id] ?? null,
  ) as SessionUsage | null;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  const stats = useMemo(() => {
    const pricing = resolvePricing(session.model);
    const inT = usage ? estimateTokens(usage.bytesIn) : 0;
    const outT = usage ? estimateTokens(usage.bytesOut) : 0;
    return {
      inT,
      outT,
      used: inT + outT,
      total: pricing.contextWindow,
      cost: estimateCostUsd(session.model, outT, inT),
    };
  }, [usage, session.model]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.projectPath} title={session.project_path}>
            {session.project_path}
          </div>
          <div className={styles.meta}>
            <span>{session.model ?? "default model"}</span>
            <span className={styles.dot}>•</span>
            <span className={styles[session.status]}>{session.status}</span>
            <span className={styles.dot}>•</span>
            <span>
              in {formatTokens(stats.inT)} · out {formatTokens(stats.outT)}
            </span>
            <span className={styles.dot}>•</span>
            <span>{formatCost(stats.cost)}</span>
          </div>
        </div>
        <ContextRing
          used={stats.used}
          total={stats.total}
          size={54}
          label="ctx"
        />
      </div>

      <div ref={scrollRef} className={styles.log}>
        {entries.length === 0 ? (
          <div className={styles.empty}>
            <p>Session ready. Send your first message below.</p>
          </div>
        ) : (
          entries.map((entry, i) => <Entry key={i} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: SessionEntry }) {
  if (entry.kind === "user") {
    return (
      <div className={`${styles.entry} ${styles.userEntry}`}>
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
