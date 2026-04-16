import { memo, useCallback } from "react";

import type { CatalogEntry } from "@/lib/types";

import styles from "./CatalogListItem.module.css";

type Props = {
  entry: CatalogEntry;
  selected: boolean;
  onSelect: (entry: CatalogEntry) => void;
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export const CatalogListItem = memo(
  function CatalogListItem({ entry, selected, onSelect }: Props) {
    const isInstalled = entry.installed != null;
    const hasUpdate = entry.installed?.has_update ?? false;
    const isPlugin = entry.entry_type === "Plugin";

    const handleClick = useCallback(() => {
      onSelect(entry);
    }, [onSelect, entry]);

    return (
      <button
        type="button"
        className={`${styles.root} ${selected ? styles.selected : ""}`}
        onClick={handleClick}
      >
        <div className={styles.topRow}>
          <span className={`${styles.dot} ${isInstalled ? styles.dotInstalled : styles.dotAvailable}`} />
          <span className={styles.name}>{entry.name}</span>
          <span className={`${styles.badge} ${isPlugin ? styles.badgePlugin : styles.badgeSkill}`}>
            {isPlugin ? "Plugin" : "Skill"}
          </span>
          {hasUpdate ? <span className={styles.updateDot} /> : null}
        </div>
        <div className={styles.meta}>
          {entry.description ? (
            <span className={styles.description}>{entry.description}</span>
          ) : entry.install_count != null ? (
            <span className={styles.count}>{formatCount(entry.install_count)} installs</span>
          ) : null}
        </div>
      </button>
    );
  },
  (prev, next) =>
    prev.entry.id === next.entry.id &&
    prev.selected === next.selected,
);
