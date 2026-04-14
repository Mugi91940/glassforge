import { useEffect, useState } from "react";
import { BarChart3, Clock, Plus, Sparkles, Terminal, X } from "lucide-react";

import * as log from "@/lib/log";
import { createSession } from "@/lib/tauri-commands";
import { useProjectHistoryStore } from "@/stores/projectHistoryStore";
import { useSessionStore } from "@/stores/sessionStore";

import { SessionCard } from "@/components/sessions/SessionCard";
import { SkillsPanel } from "@/components/skills/SkillsPanel";
import { UsagePanel } from "@/components/stats/UsagePanel";

import styles from "./Sidebar.module.css";

type Tab = "sessions" | "usage" | "skills";

export function Sidebar() {
  const order = useSessionStore((s) => s.order);
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
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

  useEffect(() => {
    void historyLoad();
  }, [historyLoad]);

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
    <aside className={styles.root}>
      <div className={styles.newSession}>
        <label className={styles.label} htmlFor="project-path">
          Project path
        </label>
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
          className={styles.newButton}
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
                      void spawnSession(p.path);
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
        >
          <Terminal size={12} />
          <span className={styles.tabCount}>{order.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "usage" ? styles.tabActive : ""}`}
          onClick={() => setTab("usage")}
          aria-label="Usage"
        >
          <BarChart3 size={12} />
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "skills" ? styles.tabActive : ""}`}
          onClick={() => setTab("skills")}
          aria-label="Skills"
        >
          <Sparkles size={12} />
        </button>
      </div>

      <div className={styles.tabBody}>
        {tab === "sessions" &&
          (order.length === 0 ? (
            <p className={styles.empty}>No sessions yet.</p>
          ) : (
            <ul className={styles.list}>
              {order.map((id) => {
                const s = sessions[id];
                if (!s) return null;
                return (
                  <li key={id}>
                    <SessionCard
                      session={s}
                      active={id === activeId}
                      onSelect={() => setActive(id)}
                    />
                  </li>
                );
              })}
            </ul>
          ))}
        {tab === "usage" && <UsagePanel />}
        {tab === "skills" && <SkillsPanel />}
      </div>
    </aside>
  );
}
