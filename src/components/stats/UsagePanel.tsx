import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import * as log from "@/lib/log";
import { formatCost, formatTokens, prettyModelName } from "@/lib/pricing";
import { computeSessionStats } from "@/lib/sessionStats";
import { usePreferencesStore } from "@/stores/preferencesStore";
import {
  getClaudeUsage,
  getRateLimits,
  type ClaudeUsageSnapshot,
  type ClaudeUsageTotals,
  type RateLimits,
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
  last5h: EMPTY_TOTALS,
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

export function UsagePanel() {
  const order = useSessionStore((s) => s.order);
  const sessions = useSessionStore((s) => s.sessions);
  const liveUsage = useSessionStore((s) => s.usage);
  const longContextScope = usePreferencesStore((s) => s.longContextScope);

  const [snap, setSnap] = useState<ClaudeUsageSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rates, setRates] = useState<RateLimits | null>(null);
  const [ratesErr, setRatesErr] = useState<string | null>(null);

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
    // Rate limits hit Anthropic's private OAuth endpoint; treat as
    // best-effort and surface the error separately from local totals.
    try {
      const r = await getRateLimits();
      setRates(r);
      setRatesErr(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRatesErr(msg);
      setRates(null);
      log.warn("get_rate_limits failed", msg);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const h = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(h);
  }, [refresh]);

  const lastActivity = useMemo(
    () => formatRelative(snap.lastActivityIso),
    [snap.lastActivityIso],
  );

  const fiveHourPct = rates?.fiveHour?.usedPercentage ?? null;
  const weeklyPct = rates?.sevenDay?.usedPercentage ?? null;
  const opusPct = rates?.sevenDayOpus?.usedPercentage ?? null;
  const sonnetPct = rates?.sevenDaySonnet?.usedPercentage ?? null;

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

      {!loading && !err && snap.sessionCount === 0 && snap.allTime.messages === 0 ? (
        <p className={styles.ratesHint}>
          Usage data appears after your first message. Token counts, costs, and
          rate limits will be shown here.
        </p>
      ) : null}

      {fiveHourPct !== null || weeklyPct !== null ? (
        <div className={styles.rateLimits}>
          {fiveHourPct !== null ? (
            <LimitsBar
              label="5-hour window"
              used={Math.round(fiveHourPct * 100)}
              total={10_000}
              format={() => `${fiveHourPct.toFixed(1)}%`}
            />
          ) : null}
          {weeklyPct !== null ? (
            <LimitsBar
              label="Weekly"
              used={Math.round(weeklyPct * 100)}
              total={10_000}
              format={() => `${weeklyPct.toFixed(1)}%`}
            />
          ) : null}
          {opusPct !== null ? (
            <LimitsBar
              label="Weekly · Opus"
              used={Math.round(opusPct * 100)}
              total={10_000}
              format={() => `${opusPct.toFixed(1)}%`}
            />
          ) : null}
          {sonnetPct !== null ? (
            <LimitsBar
              label="Weekly · Sonnet"
              used={Math.round(sonnetPct * 100)}
              total={10_000}
              format={() => `${sonnetPct.toFixed(1)}%`}
            />
          ) : null}
        </div>
      ) : ratesErr ? (
        <div className={styles.ratesHint}>
          Live /usage unavailable: {ratesErr}
        </div>
      ) : (
        <div className={styles.ratesHint}>
          Live /usage not yet fetched. Refresh to retry.
        </div>
      )}

      <div className={styles.buckets}>
        <BucketCard label="Last 5 hours" totals={snap.last5h} />
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
                  {formatTokens(
                    m.totals.inputTokens + m.totals.outputTokens,
                  )}
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
              // Route through the shared helper so the sidebar can
              // never drift from the ChatView header — same inputs,
              // same formula, same output.
              const stats = computeSessionStats(u, s, longContextScope);
              const modelLabel = u.detectedModel
                ? prettyModelName(u.detectedModel)
                : s.model ?? "default";
              return (
                <li key={id} className={styles.listItem}>
                  <div className={styles.rowHeader}>
                    <span className={styles.name}>
                      {s.project_path
                        .split("/")
                        .filter(Boolean)
                        .pop() ?? "—"}
                    </span>
                    <span className={styles.model}>
                      {modelLabel}
                    </span>
                  </div>
                  <div className={styles.rowStats}>
                    <span>
                      in {formatTokens(stats.inT)} · out{" "}
                      {formatTokens(stats.outT)}
                    </span>
                    <span>{formatCost(stats.cumulativeCostUsd)}</span>
                  </div>
                  <LimitsBar
                    label="Context"
                    used={stats.ctxUsed}
                    total={stats.ctxTotal}
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
