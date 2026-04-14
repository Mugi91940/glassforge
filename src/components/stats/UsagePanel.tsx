import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Zap, ZapOff } from "lucide-react";

import * as log from "@/lib/log";
import {
  estimateTokens,
  formatCost,
  formatTokens,
  resolvePricing,
} from "@/lib/pricing";
import {
  loadPlan,
  PLAN_LIST,
  resolvePlan,
  savePlan,
  type Plan,
  type PlanId,
} from "@/lib/plan";
import {
  getClaudeUsage,
  getRateLimits,
  getUsageHookStatus,
  installUsageHook,
  uninstallUsageHook,
  type ClaudeUsageSnapshot,
  type ClaudeUsageTotals,
  type RateLimits,
  type UsageHookStatus,
} from "@/lib/tauri-commands";
import { useSessionStore } from "@/stores/sessionStore";

import { Dropdown, type DropdownOption } from "@/components/ui/Dropdown";
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

const PLAN_OPTIONS: DropdownOption<PlanId>[] = PLAN_LIST.map((p) => ({
  label: p.label,
  value: p.id,
}));

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

function billableTokens(t: ClaudeUsageTotals): number {
  // For rate-limit comparisons we count everything the plan counts:
  // input + output + cache creation. Cache reads are billed differently
  // and don't really consume the same budget, so leave them out here.
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens;
}

export function UsagePanel() {
  const order = useSessionStore((s) => s.order);
  const sessions = useSessionStore((s) => s.sessions);
  const liveUsage = useSessionStore((s) => s.usage);

  const [snap, setSnap] = useState<ClaudeUsageSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [planId, setPlanIdState] = useState<PlanId>(() => loadPlan());
  const [hook, setHook] = useState<UsageHookStatus | null>(null);
  const [rates, setRates] = useState<RateLimits | null>(null);
  const [hookBusy, setHookBusy] = useState(false);

  const plan: Plan = useMemo(() => resolvePlan(planId), [planId]);

  const setPlanId = useCallback((next: PlanId) => {
    setPlanIdState(next);
    savePlan(next);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, h, r] = await Promise.all([
        getClaudeUsage(),
        getUsageHookStatus(),
        getRateLimits(),
      ]);
      setSnap(s);
      setHook(h);
      setRates(r);
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
    const h = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(h);
  }, [refresh]);

  async function onInstallHook() {
    setHookBusy(true);
    setErr(null);
    try {
      const h = await installUsageHook();
      setHook(h);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
    } finally {
      setHookBusy(false);
    }
  }

  async function onUninstallHook() {
    setHookBusy(true);
    setErr(null);
    try {
      const h = await uninstallUsageHook();
      setHook(h);
      setRates(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
    } finally {
      setHookBusy(false);
    }
  }

  const liveRates =
    rates &&
    (rates.fiveHour !== null || rates.sevenDay !== null) &&
    rates.staleSeconds < 60 * 15;

  const lastActivity = useMemo(
    () => formatRelative(snap.lastActivityIso),
    [snap.lastActivityIso],
  );

  const fiveHourUsed = billableTokens(snap.last5h);
  const weeklyUsed = billableTokens(snap.last7d);

  const fiveHourPct = liveRates
    ? (rates?.fiveHour?.usedPercentage ?? null)
    : null;
  const weeklyPct = liveRates
    ? (rates?.sevenDay?.usedPercentage ?? null)
    : null;

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

      {hook ? (
        hook.installed ? (
          <div className={styles.hookActive}>
            <Zap size={11} />
            <span>
              Live /usage hook active ·{" "}
              {rates?.capturedAtIso
                ? `${formatRelative(rates.capturedAtIso)}`
                : "waiting for first claude run"}
            </span>
            <button
              type="button"
              className={styles.hookToggle}
              onClick={() => void onUninstallHook()}
              disabled={hookBusy}
            >
              disable
            </button>
          </div>
        ) : (
          <div className={styles.hookInstall}>
            <ZapOff size={11} />
            <div className={styles.hookText}>
              <strong>Live usage not enabled</strong>
              <span>
                GlassForge can install a statusLine hook in your
                ~/.claude/settings.json to capture the real /usage data
                (five-hour + weekly). Your existing settings.json is backed
                up first.
              </span>
            </div>
            <button
              type="button"
              className={styles.hookToggle}
              onClick={() => void onInstallHook()}
              disabled={hookBusy}
            >
              {hookBusy ? "Installing…" : "Enable"}
            </button>
          </div>
        )
      ) : null}

      <div className={styles.planRow}>
        <span className={styles.planLabel}>Plan</span>
        <Dropdown
          size="sm"
          fullWidth
          ariaLabel="Plan"
          options={PLAN_OPTIONS}
          value={planId}
          onChange={setPlanId}
        />
      </div>

      <div className={styles.rateLimits}>
        {fiveHourPct !== null ? (
          <LimitsBar
            label="5-hour window (live)"
            used={Math.round(fiveHourPct * 100)}
            total={10_000}
            format={() => `${fiveHourPct.toFixed(1)}%`}
          />
        ) : (
          <LimitsBar
            label="5-hour window (est.)"
            used={fiveHourUsed}
            total={plan.fiveHourTokens}
            format={(u, t) => `${formatTokens(u)} / ${formatTokens(t)}`}
          />
        )}
        {weeklyPct !== null ? (
          <LimitsBar
            label="Weekly (live)"
            used={Math.round(weeklyPct * 100)}
            total={10_000}
            format={() => `${weeklyPct.toFixed(1)}%`}
          />
        ) : plan.weeklyTokens !== null ? (
          <LimitsBar
            label="Weekly (est.)"
            used={weeklyUsed}
            total={plan.weeklyTokens}
            format={(u, t) => `${formatTokens(u)} / ${formatTokens(t)}`}
          />
        ) : (
          <div className={styles.noWeekly}>
            Weekly limit: not enforced on {plan.label}
          </div>
        )}
      </div>

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
