import styles from "./ContextRing.module.css";

type Props = {
  used: number;
  total: number;
  size?: number;
  // Full detected model string, surfaced as a tooltip on hover for
  // people debugging the ring vs claude-code's /context reading.
  modelName?: string | null;
};

function formatCapacity(total: number): string {
  if (total >= 1_000_000) return `${Math.round(total / 1_000_000)}M`;
  if (total >= 1_000) return `${Math.round(total / 1_000)}k`;
  return String(total);
}

export function ContextRing({
  used,
  total,
  size = 64,
  modelName,
}: Props) {
  const pct = total > 0 ? Math.min(1, used / total) : 0;
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  const tone =
    pct < 0.5 ? "safe" : pct < 0.8 ? "warning" : "danger";

  const cap = formatCapacity(total);
  const title = modelName
    ? `${modelName} · ${cap} window`
    : `${cap} context window`;

  return (
    <div
      className={styles.root}
      style={{ width: size, height: size }}
      title={title}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={`${styles.svg} ${styles[tone]}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={styles.track}
          strokeWidth={4}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={styles.fill}
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className={styles.label}>
        <span className={styles.pct}>{Math.round(pct * 100)}%</span>
        <span className={styles.sub}>{cap}</span>
      </div>
    </div>
  );
}
