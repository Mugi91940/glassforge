import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

import styles from "./ConfirmModal.module.css";

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  dismissibleKey?: string;
  dismissed?: boolean;
  onDismissToggle?: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  dismissibleKey,
  dismissed,
  onDismissToggle,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return createPortal(
    <div className={styles.overlay} role="presentation" onClick={onCancel}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <AlertTriangle
            size={15}
            className={`${styles.icon} ${danger ? styles.danger : ""}`}
          />
          <h2 className={styles.title}>{title}</h2>
        </header>

        <p className={styles.description}>{description}</p>

        {dismissibleKey ? (
          <label className={styles.dismissRow}>
            <input
              type="checkbox"
              checked={!!dismissed}
              onChange={(e) => onDismissToggle?.(e.target.checked)}
            />
            <span>Don't show this warning again</span>
          </label>
        ) : null}

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.cancel}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`${styles.confirm} ${danger ? styles.confirmDanger : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
