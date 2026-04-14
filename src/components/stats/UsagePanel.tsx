import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  estimateCostUsd,
  estimateTokens,
  formatCost,
  formatTokens,
  resolvePricing,
} from "@/lib/pricing";
import type { SessionInfo } from "@/lib/types";
import { useLimitsStore } from "@/stores/limitsStore";
import { useSessionStore, type SessionUsage } from "@/stores/sessionStore";

import { LimitsBar } from "./LimitsBar";

import styles from "./UsagePanel.module.css";

type AggregatedTotals = {
  tokensIn: number;
  tokensOut: number;
  messages: number;
  costUsd: number;
};

function aggregate(
  sessions: Record<string, SessionInfo>,
  usage: Record<string, SessionUsage>,
): AggregatedTotals {
  let tokensIn = 0;
  let tokensOut = 0;
  let messages = 0;
  let costUsd = 0;
  for (const id of Object.keys(sessions)) {
    const u = usage[id];
    if (!u) continue;
    const inT = estimateTokens(u.bytesIn);
    const outT = estimateTokens(u.bytesOut);
    tokensIn += inT;
    tokensOut += outT;
    messages += u.messages;
    costUsd += estimateCostUsd(sessions[id]?.model ?? null, outT, inT);
  }
  return { tokensIn, tokensOut, messages, costUsd };
}

export function UsagePanel() {
  const { sessions, usage, order } = useSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      usage: s.usage,
      order: s.order,
    })),
  );
  const limits = useLimitsStore((s) => s.config);

  const totals = useMemo(
    () => aggregate(sessions, usage),
    [sessions, usage],
  );

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h3 className={styles.title}>Usage</h3>
        <span className={styles.subtitle}>
          {order.length} session{order.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className={styles.totals}>
        <Stat label="Tokens in" value={formatTokens(totals.tokensIn)} />
        <Stat label="Tokens out" value={formatTokens(totals.tokensOut)} />
        <Stat label="Messages" value={String(totals.messages)} />
        <Stat label="Est. cost" value={formatCost(totals.costUsd)} />
      </div>

      <div className={styles.bars}>
        <LimitsBar
          label="Concurrent sessions"
          used={order.length}
          total={limits.maxConcurrentSessions}
        />
        <LimitsBar
          label="Daily messages"
          used={totals.messages}
          total={limits.dailyMessageBudget}
        />
        <LimitsBar
          label="Weekly tokens"
          used={totals.tokensIn + totals.tokensOut}
          total={limits.weeklyTokenBudget}
          format={(u, t) => `${formatTokens(u)} / ${formatTokens(t)}`}
        />
      </div>

      <div className={styles.sessionList}>
        <h4 className={styles.sectionTitle}>Per session</h4>
        {order.length === 0 ? (
          <p className={styles.empty}>No sessions running.</p>
        ) : (
          <ul className={styles.list}>
            {order.map((id) => {
              const s = sessions[id];
              const u = usage[id];
              if (!s || !u) return null;
              const inT = estimateTokens(u.bytesIn);
              const outT = estimateTokens(u.bytesOut);
              const cost = estimateCostUsd(s.model ?? null, outT, inT);
              const p = resolvePricing(s.model ?? null);
              return (
                <li key={id} className={styles.listItem}>
                  <div className={styles.rowHeader}>
                    <span className={styles.name}>
                      {s.project_path.split("/").filter(Boolean).pop() ?? "—"}
                    </span>
                    <span className={styles.model}>
                      {s.model ?? "default"}
                    </span>
                  </div>
                  <div className={styles.rowStats}>
                    <span>
                      in {formatTokens(inT)} · out {formatTokens(outT)}
                    </span>
                    <span>{formatCost(cost)}</span>
                  </div>
                  <div className={styles.context}>
                    <LimitsBar
                      label="Context"
                      used={inT + outT}
                      total={p.contextWindow}
                      format={(u2, t2) =>
                        `${formatTokens(u2)} / ${formatTokens(t2)}`
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}
