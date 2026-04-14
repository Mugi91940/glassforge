import { Minus, Settings, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";

import styles from "./TopBar.module.css";

type TopBarProps = {
  onOpenSettings: () => void;
};

export function TopBar({ onOpenSettings }: TopBarProps) {
  const [win] = useState(() => getCurrentWindow());

  return (
    <header className={styles.root} data-tauri-drag-region>
      <div className={styles.brand} data-tauri-drag-region>
        <div className={styles.logoDot} aria-hidden="true" />
        <span className={styles.brandName}>GlassForge</span>
      </div>

      <div className={styles.spacer} data-tauri-drag-region />

      <div className={styles.controls}>
        <button
          className={styles.controlButton}
          aria-label="Settings"
          onClick={onOpenSettings}
          type="button"
        >
          <Settings size={14} />
        </button>
        <button
          className={styles.controlButton}
          aria-label="Minimize"
          onClick={() => win.minimize()}
          type="button"
        >
          <Minus size={14} />
        </button>
        <button
          className={`${styles.controlButton} ${styles.closeButton}`}
          aria-label="Close"
          onClick={() => win.close()}
          type="button"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
