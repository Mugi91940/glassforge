import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Clock,
  FolderOpen,
  Plus,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { homeDir } from "@tauri-apps/api/path";

import * as log from "@/lib/log";
import { createSession } from "@/lib/tauri-commands";
import { useProjectHistoryStore } from "@/stores/projectHistoryStore";
import { useSessionStore } from "@/stores/sessionStore";

import { SessionsForProject } from "@/components/sessions/SessionsForProject";
import { SkillsPanel } from "@/components/skills/SkillsPanel";
import { UsagePanel } from "@/components/stats/UsagePanel";
import { ProjectPicker } from "@/components/ui/ProjectPicker";

import styles from "./Sidebar.module.css";

type Tab = "sessions" | "usage" | "skills";

const SIDEBAR_WIDTH_KEY = "glassforge.sidebarWidth";
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 260;

function loadSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(v) && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX) {
      return v;
    }
  } catch {
    // localStorage unavailable
  }
  return SIDEBAR_DEFAULT;
}

export function Sidebar() {
  const order = useSessionStore((s) => s.order);
  const setActive = useSessionStore((s) => s.setActive);
  const addSession = useSessionStore((s) => s.addSession);

  const history = useProjectHistoryStore((s) => s.projects);
  const historyLoad = useProjectHistoryStore((s) => s.load);
  const historyTouch = useProjectHistoryStore((s) => s.touch);
  const historyRemove = useProjectHistoryStore((s) => s.remove);
  const historyClear = useProjectHistoryStore((s) => s.clear);

  const [tab, setTab] = useState<Tab>("sessions");
  const [projectPath, setProjectPath] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [width, setWidth] = useState<number>(() => loadSidebarWidth());
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      // swallow
    }
  }, [width]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const startX = e.clientX;
    const startWidth = root.getBoundingClientRect().width;

    function onMove(me: MouseEvent) {
      const delta = me.clientX - startX;
      const next = Math.max(
        SIDEBAR_MIN,
        Math.min(SIDEBAR_MAX, startWidth + delta),
      );
      setWidth(next);
    }
    function onUp() {
      document.body.classList.remove(styles.resizing);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    document.body.classList.add(styles.resizing);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    void historyLoad();
  }, [historyLoad]);

  // Seed the input with $HOME on first mount so users don't start from
  // an empty field. We only set it if the field is still blank.
  useEffect(() => {
    let cancelled = false;
    homeDir()
      .then((home) => {
        if (!cancelled) {
          setProjectPath((current) => (current ? current : home));
        }
      })
      .catch((e) => log.warn("homeDir failed", e));
    return () => {
      cancelled = true;
    };
  }, []);

  function onBrowse() {
    setErr(null);
    setPickerOpen(true);
  }

  function onPickerSelect(path: string) {
    setProjectPath(path);
    setPickerOpen(false);
    setErr(null);
  }

  async function spawnSession(path: string) {
    const trimmed = path.trim();
    if (!trimmed) {
      setErr("Enter a project path first");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const info = await createSession(trimmed, null);
      addSession(info);
      setActive(info.id);
      void historyTouch(trimmed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      log.error("create_session failed", msg);
    } finally {
      setBusy(false);
    }
  }

  async function onNew() {
    await spawnSession(projectPath);
  }

  return (
    <aside
      ref={rootRef}
      className={styles.root}
      style={{ width: `${width}px`, minWidth: `${width}px` }}
    >
      <div className={styles.newSession}>
        <label className={styles.label} htmlFor="project-path">
          Project path
        </label>
        <div className={styles.pathRow}>
          <input
            id="project-path"
            className={styles.input}
            type="text"
            placeholder="/home/you/project"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className={styles.browseButton}
            onClick={onBrowse}
            aria-label="Browse for a project directory"
            title="Browse…"
          >
            <FolderOpen size={14} />
          </button>
        </div>
        <button
          type="button"
          className={styles.newButton}
          title="New session (Ctrl+N)"
          onClick={onNew}
          disabled={busy}
        >
          <Plus size={14} />
          <span>{busy ? "Spawning…" : "New session"}</span>
        </button>
        {err ? <p className={styles.error}>{err}</p> : null}
      </div>

      {history.length > 0 ? (
        <div className={styles.history}>
          <div className={styles.historyHeader}>
            <Clock size={10} />
            <span>Recent projects</span>
            <button
              type="button"
              className={styles.historyClear}
              onClick={() => void historyClear()}
              aria-label="Clear history"
            >
              clear
            </button>
          </div>
          <ul className={styles.historyList}>
            {history.map((p) => {
              const name =
                p.path.split("/").filter(Boolean).pop() ?? p.path;
              return (
                <li key={p.path} className={styles.historyItem}>
                  <button
                    type="button"
                    className={styles.historyButton}
                    onClick={() => {
                      setProjectPath(p.path);
                      void historyTouch(p.path);
                    }}
                    title={p.path}
                  >
                    <span className={styles.historyName}>{name}</span>
                    <span className={styles.historyPath}>{p.path}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.historyRemove}
                    onClick={(e) => {
                      e.stopPropagation();
                      void historyRemove(p.path);
                    }}
                    aria-label={`Remove ${name}`}
                  >
                    <X size={10} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "sessions" ? styles.tabActive : ""}`}
          onClick={() => setTab("sessions")}
          aria-label="Sessions"
          title="Sessions (Ctrl+Tab)"
        >
          <Terminal size={12} />
          <span className={styles.tabCount}>{order.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "usage" ? styles.tabActive : ""}`}
          onClick={() => setTab("usage")}
          aria-label="Usage"
          title="Usage"
        >
          <BarChart3 size={12} />
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "skills" ? styles.tabActive : ""}`}
          onClick={() => setTab("skills")}
          aria-label="Skills"
          title="Skills"
        >
          <Sparkles size={12} />
        </button>
      </div>

      <div className={styles.tabBody}>
        {tab === "sessions" && <SessionsForProject projectPath={projectPath} />}
        {tab === "usage" && <UsagePanel />}
        {tab === "skills" && <SkillsPanel />}
      </div>

      {pickerOpen ? (
        <ProjectPicker
          initialPath={projectPath || undefined}
          onSelect={onPickerSelect}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      <div
        className={styles.resizeHandle}
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize"
      />
    </aside>
  );
}
