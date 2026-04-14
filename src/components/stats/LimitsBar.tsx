import styles from "./LimitsBar.module.css";

type Props = {
  label: string;
  used: number;
  total: number;
  format?: (used: number, total: number) => string;
};

export function LimitsBar({ label, used, total, format }: Props) {
  const pct = total > 0 ? Math.min(1, used / total) : 0;
  const tone =
    pct < 0.8 ? "safe" : pct < 0.95 ? "warning" : "danger";
  const display = format
    ? format(used, total)
    : `${used} / ${total}`;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{display}</span>
      </div>
      <div className={styles.track}>
        <div
          className={`${styles.fill} ${styles[tone]}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
