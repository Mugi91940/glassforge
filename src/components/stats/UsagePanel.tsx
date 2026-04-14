import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import * as log from "@/lib/log";
import {
  estimateTokens,
  formatCost,
  formatTokens,
  resolvePricing,
} from "@/lib/pricing";
import {
  getClaudeUsage,
  type ClaudeUsageSnapshot,
  type ClaudeUsageTotals,
} from "@/lib/tauri-commands";
import { useSessionStore } from "@/stores/sessionStore";

import { LimitsBar } from "./LimitsBar";

import styles from "./UsagePanel.module.css";

const EMPTY_TOTALS: ClaudeUsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  messages: 0,
};

const EMPTY_SNAPSHOT: ClaudeUsageSnapshot = {
  today: EMPTY_TOTALS,
  last7d: EMPTY_TOTALS,
  allTime: EMPTY_TOTALS,
  byModel: [],
  lastActivityIso: null,
  sessionCount: 0,
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const delta = Math.max(0, Date.now() - then);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function totalTokens(t: ClaudeUsageTotals): number {
  return t.inputTokens + t.outputTokens;
}

export function UsagePanel() {
  const order = useSessionStore((s) => s.order);
  const sessions = useSessionStore((s) => s.sessions);
  const liveUsage = useSessionStore((s) => s.usage);

  const [snap, setSnap] = useState<ClaudeUsageSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const s = await getClaudeUsage();
      setSnap(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      log.warn("get_claude_usage failed", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Re-fetch every 30s while the panel is mounted; claude writes to the
    // JSONL files live as messages flow so we want reasonable freshness.
    const h = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(h);
  }, [refresh]);

  const lastActivity = useMemo(
    () => formatRelative(snap.lastActivityIso),
    [snap.lastActivityIso],
  );

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h3 className={styles.title}>Usage</h3>
          <span className={styles.subtitle}>
            {snap.sessionCount} total · last {lastActivity}
          </span>
        </div>
        <button
          type="button"
          className={`${styles.refresh} ${loading ? styles.spinning : ""}`}
          onClick={() => void refresh()}
          aria-label="Refresh usage"
        >
          <RefreshCw size={12} />
        </button>
      </header>

      {err ? <p className={styles.error}>{err}</p> : null}

      <div className={styles.buckets}>
        <BucketCard label="Today" totals={snap.today} />
        <BucketCard label="Last 7 days" totals={snap.last7d} />
        <BucketCard label="All time" totals={snap.allTime} />
      </div>

      {snap.byModel.length > 0 ? (
        <div className={styles.byModel}>
          <h4 className={styles.sectionTitle}>By model (all time)</h4>
          <ul className={styles.modelList}>
            {snap.byModel.map((m) => (
              <li key={m.model} className={styles.modelRow}>
                <span className={styles.modelName}>{m.model}</span>
                <span className={styles.modelTokens}>
                  {formatTokens(totalTokens(m.totals))}
                </span>
                <span className={styles.modelCost}>
                  {formatCost(m.totals.costUsd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {order.length > 0 ? (
        <div className={styles.sessionList}>
          <h4 className={styles.sectionTitle}>Live sessions</h4>
          <ul className={styles.list}>
            {order.map((id) => {
              const s = sessions[id];
              const u = liveUsage[id];
              if (!s || !u) return null;
              const inT = estimateTokens(u.bytesIn);
              const outT = estimateTokens(u.bytesOut);
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
                    <span>{formatCost(u.totalCostUsd)}</span>
                  </div>
                  <LimitsBar
                    label="Context"
                    used={inT + outT}
                    total={p.contextWindow}
                    format={(a, b) =>
                      `${formatTokens(a)} / ${formatTokens(b)}`
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function BucketCard({
  label,
  totals,
}: {
  label: string;
  totals: ClaudeUsageTotals;
}) {
  return (
    <div className={styles.bucket}>
      <div className={styles.bucketLabel}>{label}</div>
      <div className={styles.bucketCost}>{formatCost(totals.costUsd)}</div>
      <div className={styles.bucketMeta}>
        <span>
          in {formatTokens(totals.inputTokens)} · out{" "}
          {formatTokens(totals.outputTokens)}
        </span>
        <span>{totals.messages} msgs</span>
      </div>
      {totals.cacheReadTokens > 0 || totals.cacheCreationTokens > 0 ? (
        <div className={styles.bucketCache}>
          cache read {formatTokens(totals.cacheReadTokens)} · created{" "}
          {formatTokens(totals.cacheCreationTokens)}
        </div>
      ) : null}
    </div>
  );
}
