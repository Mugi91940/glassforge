import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  RefreshCw,
} from "lucide-react";

import * as log from "@/lib/log";
import {
  createSession,
  listProjectSessions,
  loadSessionHistory,
  type ClaudeProjectSummary,
} from "@/lib/tauri-commands";
import type { ChatEntry, SessionInfo } from "@/lib/types";
import { useSessionStore } from "@/stores/sessionStore";

import styles from "./ProjectsTree.module.css";

type GroupedSession = {
  key: string;
  kind: "live" | "historical";
  label: string;
  preview: string | null;
  lastTs: string | null;
  claudeSessionId: string | null;
  liveSession?: SessionInfo;
};

function projectName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const d = Date.now() - then;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

export function ProjectsTree() {
  const liveOrder = useSessionStore((s) => s.order);
  const liveSessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const addSession = useSessionStore((s) => s.addSession);
  const seedEntries = useSessionStore((s) => s.seedEntries);

  const [historical, setHistorical] = useState<ClaudeProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [resuming, setResuming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const rows = await listProjectSessions();
      setHistorical(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      log.warn("list_project_sessions failed", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Merge live + historical into a single list of projects keyed by path.
  const projects = useMemo(() => {
    const byPath = new Map<
      string,
      {
        path: string;
        sessions: GroupedSession[];
        lastTs: string | null;
      }
    >();

    for (const p of historical) {
      const sessions: GroupedSession[] = p.sessions.map((s) => ({
        key: s.id,
        kind: "historical",
        label: s.preview ?? `session ${s.id.slice(0, 8)}`,
        preview: s.preview,
        lastTs: s.lastTs,
        claudeSessionId: s.id,
      }));
      byPath.set(p.path, {
        path: p.path,
        sessions,
        lastTs: p.sessions[0]?.lastTs ?? null,
      });
    }

    for (const id of liveOrder) {
      const info = liveSessions[id];
      if (!info) continue;
      const existing = byPath.get(info.project_path);
      const live: GroupedSession = {
        key: `live-${id}`,
        kind: "live",
        label:
          info.claude_session_id ?? `session ${id.slice(0, 8)}`,
        preview: null,
        lastTs: new Date(info.created_at * 1000).toISOString(),
        claudeSessionId: info.claude_session_id,
        liveSession: info,
      };
      if (existing) {
        // If a historical entry with the same claude_session_id already
        // exists, promote it to "live" by replacing it.
        const idx = existing.sessions.findIndex(
          (s) =>
            s.kind === "historical" &&
            info.claude_session_id &&
            s.claudeSessionId === info.claude_session_id,
        );
        if (idx >= 0) existing.sessions[idx] = live;
        else existing.sessions.unshift(live);
      } else {
        byPath.set(info.project_path, {
          path: info.project_path,
          sessions: [live],
          lastTs: live.lastTs,
        });
      }
    }

    return Array.from(byPath.values()).sort((a, b) => {
      const al = a.lastTs ?? "";
      const bl = b.lastTs ?? "";
      return bl.localeCompare(al);
    });
  }, [historical, liveOrder, liveSessions]);

  async function onClickSession(projectPath: string, s: GroupedSession) {
    if (s.kind === "live" && s.liveSession) {
      setActive(s.liveSession.id);
      return;
    }
    if (!s.claudeSessionId) return;
    setResuming(s.claudeSessionId);
    try {
      const info = await createSession(projectPath, null, s.claudeSessionId);
      addSession(info);
      setActive(info.id);
      const history = (await loadSessionHistory(
        s.claudeSessionId,
      )) as ChatEntry[];
      seedEntries(info.id, history);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("resume session failed", msg);
      setErr(msg);
    } finally {
      setResuming(null);
    }
  }

  function toggle(path: string) {
    setCollapsed((c) => ({ ...c, [path]: !c[path] }));
  }

  if (loading && projects.length === 0) {
    return <p className={styles.empty}>Scanning ~/.claude/projects…</p>;
  }

  if (projects.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No projects yet. Spawn one above.</p>
        {err ? <p className={styles.error}>{err}</p> : null}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Projects</span>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void refresh()}
          aria-label="Refresh"
          title="Rescan"
        >
          <RefreshCw
            size={11}
            className={loading ? styles.spinning : undefined}
          />
        </button>
      </div>

      {err ? <p className={styles.error}>{err}</p> : null}

      <ul className={styles.list}>
        {projects.map((p) => {
          const isCollapsed = collapsed[p.path] ?? false;
          const name = projectName(p.path);
          return (
            <li key={p.path} className={styles.project}>
              <button
                type="button"
                className={styles.projectHeader}
                onClick={() => toggle(p.path)}
                title={p.path}
              >
                {isCollapsed ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                <Folder size={12} className={styles.projectIcon} />
                <span className={styles.projectName}>{name}</span>
                <span className={styles.projectCount}>
                  {p.sessions.length}
                </span>
              </button>
              {!isCollapsed ? (
                <ul className={styles.sessionList}>
                  {p.sessions.map((s) => {
                    const isActive =
                      s.liveSession && s.liveSession.id === activeId;
                    const isResuming =
                      resuming && s.claudeSessionId === resuming;
                    return (
                      <li key={s.key}>
                        <button
                          type="button"
                          className={`${styles.sessionCard} ${
                            isActive ? styles.sessionActive : ""
                          } ${s.kind === "historical" ? styles.sessionHistorical : ""}`}
                          onClick={() => void onClickSession(p.path, s)}
                          disabled={!!isResuming}
                        >
                          <MessageSquare
                            size={11}
                            className={styles.sessionIcon}
                          />
                          <div className={styles.sessionText}>
                            <span className={styles.sessionLabel}>
                              {s.label}
                            </span>
                            <span className={styles.sessionMeta}>
                              {s.kind === "live" ? "live · " : ""}
                              {relativeTime(s.lastTs)}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
