import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  Folder,
  Home,
  Loader,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";

import * as log from "@/lib/log";

import styles from "./ProjectPicker.module.css";

type DirEntry = {
  name: string;
  path: string;
  isHidden: boolean;
};

type DirListing = {
  path: string;
  parent: string | null;
  entries: DirEntry[];
};

type Props = {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
};

export function ProjectPicker({ initialPath, onSelect, onClose }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setErr(null);
    try {
      const l = await invoke<DirListing>("list_dir", { path });
      setListing(l);
      setHighlight(0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      log.warn("list_dir failed", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const start = initialPath ?? (await homeDir().catch(() => "/"));
      if (!cancelled) await navigate(start);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialPath, navigate]);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visibleEntries = useMemo(() => {
    if (!listing) return [];
    return showHidden
      ? listing.entries
      : listing.entries.filter((e) => !e.isHidden);
  }, [listing, showHidden]);

  function onListKey(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(visibleEntries.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = visibleEntries[highlight];
      if (entry) void navigate(entry.path);
    } else if (e.key === "Backspace" && listing?.parent) {
      e.preventDefault();
      void navigate(listing.parent);
    }
  }

  const breadcrumbs = useMemo(() => {
    if (!listing) return [];
    const parts = listing.path.split("/").filter((p) => p.length > 0);
    const out: { label: string; path: string }[] = [
      { label: "/", path: "/" },
    ];
    let acc = "";
    for (const part of parts) {
      acc += "/" + part;
      out.push({ label: part, path: acc });
    }
    return out;
  }, [listing]);

  async function goHome() {
    try {
      const h = await homeDir();
      await navigate(h);
    } catch (e) {
      log.warn("homeDir failed", e);
    }
  }

  return createPortal(
    <div
      className={styles.overlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pick a project directory"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Pick a project directory</h2>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => listing?.parent && void navigate(listing.parent)}
            disabled={!listing?.parent}
            aria-label="Parent directory"
            title="Parent (Backspace)"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => void goHome()}
            aria-label="Home"
            title="Home"
          >
            <Home size={14} />
          </button>
          <div className={styles.breadcrumbs}>
            {breadcrumbs.map((b, i) => (
              <button
                key={b.path}
                type="button"
                className={`${styles.crumb} ${
                  i === breadcrumbs.length - 1 ? styles.crumbCurrent : ""
                }`}
                onClick={() => void navigate(b.path)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${styles.iconButton} ${showHidden ? styles.iconActive : ""}`}
            onClick={() => setShowHidden((h) => !h)}
            aria-label={showHidden ? "Hide hidden" : "Show hidden"}
            title={showHidden ? "Hide hidden folders" : "Show hidden folders"}
          >
            {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        </div>

        <div className={styles.listContainer}>
          {loading ? (
            <div className={styles.loading}>
              <Loader size={16} className={styles.spinner} />
              <span>Loading…</span>
            </div>
          ) : err ? (
            <div className={styles.error}>{err}</div>
          ) : visibleEntries.length === 0 ? (
            <div className={styles.empty}>
              {listing?.entries.length
                ? "No visible folders. Toggle hidden to show dotfolders."
                : "This directory has no subfolders."}
            </div>
          ) : (
            <ul
              ref={listRef}
              className={styles.list}
              tabIndex={0}
              onKeyDown={onListKey}
            >
              {visibleEntries.map((e, i) => (
                <li
                  key={e.path}
                  className={`${styles.item} ${
                    i === highlight ? styles.itemActive : ""
                  } ${e.isHidden ? styles.itemHidden : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => void navigate(e.path)}
                  onDoubleClick={() => onSelect(e.path)}
                >
                  <Folder size={13} className={styles.folderIcon} />
                  <span className={styles.itemName}>{e.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.currentPath} title={listing?.path ?? ""}>
            {listing?.path ?? "—"}
          </div>
          <button
            type="button"
            className={styles.selectButton}
            onClick={() => listing && onSelect(listing.path)}
            disabled={!listing}
          >
            <Check size={13} />
            <span>Select this folder</span>
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
