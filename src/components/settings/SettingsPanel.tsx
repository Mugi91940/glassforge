import { X } from "lucide-react";

import { PreferencesEditor } from "./PreferencesEditor";
import { ThemeEditor } from "./ThemeEditor";
import { VoiceEditor } from "./VoiceEditor";
import styles from "./SettingsPanel.module.css";

type Props = {
  onClose: () => void;
};

export function SettingsPanel({ onClose }: Props) {
  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <aside
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        aria-modal="true"
        role="dialog"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close settings"
          >
            <X size={14} />
          </button>
        </header>
        <div className={styles.body}>
          <PreferencesEditor />
          <ThemeEditor />
          <VoiceEditor />
        </div>
      </aside>
    </div>
  );
}
