import { useEffect, useState } from "react";
import { Minus, Settings, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import styles from "./TopBar.module.css";

type TopBarProps = {
  onOpenSettings: () => void;
};

export function TopBar({ onOpenSettings }: TopBarProps) {
  const [win] = useState(() => getCurrentWindow());
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    win.isMaximized().then((v) => mounted && setMaximized(v));
    const unlisten = win.onResized(async () => {
      const v = await win.isMaximized();
      if (mounted) setMaximized(v);
    });
    return () => {
      mounted = false;
      unlisten.then((fn) => fn());
    };
  }, [win]);

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
          className={styles.controlButton}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => win.toggleMaximize()}
          type="button"
        >
          <Square size={12} />
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
