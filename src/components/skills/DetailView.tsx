import { useEffect } from "react";
import { ArrowLeft, ExternalLink, Package, Sparkles } from "lucide-react";

import type { CatalogEntry } from "@/lib/types";
import { useCatalogStore } from "@/stores/catalogStore";

import { ActionBar } from "./ActionBar";
import styles from "./DetailView.module.css";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M installs`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k installs`;
  return `${n} installs`;
}

function sourceName(entry: CatalogEntry): string | null {
  const src = entry.source;
  if (typeof src === "object" && "Marketplace" in src) return src.Marketplace.name;
  if (typeof src === "object" && "Git" in src) return src.Git.url;
  return null;
}

export function DetailView({ entry }: { entry: CatalogEntry }) {
  const selectEntry = useCatalogStore((s) => s.selectEntry);
  const isPlugin = entry.entry_type === "Plugin";

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        selectEntry(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectEntry]);

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.back}
        onClick={() => selectEntry(null)}
      >
        <ArrowLeft size={14} />
        <span>Back to chat</span>
      </button>

      <div className={styles.header}>
        <div className={styles.icon}>
          {isPlugin ? <Package size={24} /> : <Sparkles size={24} />}
        </div>
        <div className={styles.headerInfo}>
          <div className={styles.titleRow}>
            <h2 className={styles.name}>{entry.name}</h2>
            <span className={`${styles.typeBadge} ${isPlugin ? styles.badgePlugin : styles.badgeSkill}`}>
              {isPlugin ? "Plugin" : "Skill"}
            </span>
          </div>
          <div className={styles.meta}>
            {entry.version ? <span>v{entry.version}</span> : null}
            {entry.author ? <span>{entry.author}</span> : null}
            {entry.install_count != null ? (
              <span>{formatCount(entry.install_count)}</span>
            ) : null}
            {entry.license ? <span>{entry.license}</span> : null}
            {sourceName(entry) ? (
              <span className={styles.source}>via {sourceName(entry)}</span>
            ) : null}
          </div>
          {entry.homepage || entry.repository ? (
            <div className={styles.links}>
              {entry.homepage ? (
                <a
                  className={styles.link}
                  href={entry.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={10} />
                  Homepage
                </a>
              ) : null}
              {entry.repository ? (
                <a
                  className={styles.link}
                  href={entry.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={10} />
                  Repository
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <ActionBar entry={entry} />

      {entry.description ? (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Description</h3>
          <p className={styles.description}>{entry.description}</p>
        </div>
      ) : null}

      {entry.category ? (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Category</h3>
          <span className={styles.categoryPill}>{entry.category}</span>
        </div>
      ) : null}

      {entry.keywords.length > 0 ? (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Keywords</h3>
          <div className={styles.keywords}>
            {entry.keywords.map((kw) => (
              <span key={kw} className={styles.keyword}>{kw}</span>
            ))}
          </div>
        </div>
      ) : null}

      {entry.installed ? (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Install path</h3>
          <code className={styles.path}>{entry.installed.path}</code>
        </div>
      ) : null}
    </div>
  );
}
