import { useState } from "react";
import { BarChart3, Plus, Terminal } from "lucide-react";

import * as log from "@/lib/log";
import { createSession } from "@/lib/tauri-commands";
import { useSessionStore } from "@/stores/sessionStore";

import { SessionCard } from "@/components/sessions/SessionCard";
import { UsagePanel } from "@/components/stats/UsagePanel";

import styles from "./Sidebar.module.css";

type Tab = "sessions" | "usage";

export function Sidebar() {
  const order = useSessionStore((s) => s.order);
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const addSession = useSessionStore((s) => s.addSession);

  const [tab, setTab] = useState<Tab>("sessions");
  const [projectPath, setProjectPath] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onNew() {
    const path = projectPath.trim();
    if (!path) {
      setErr("Enter a project path first");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const info = await createSession(path);
      addSession(info);
      setActive(info.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      log.error("create_session failed", msg);
    } finally {
      setBusy(false);
    }
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

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "sessions" ? styles.tabActive : ""}`}
          onClick={() => setTab("sessions")}
        >
          <Terminal size={12} />
          <span>Sessions</span>
          <span className={styles.tabCount}>{order.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "usage" ? styles.tabActive : ""}`}
          onClick={() => setTab("usage")}
        >
          <BarChart3 size={12} />
          <span>Usage</span>
        </button>
      </div>

      <div className={styles.tabBody}>
        {tab === "sessions" ? (
          order.length === 0 ? (
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
          )
        ) : (
          <UsagePanel />
        )}
      </div>
    </aside>
  );
}
