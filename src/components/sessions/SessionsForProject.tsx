import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, RefreshCw, Trash2 } from "lucide-react";

import * as log from "@/lib/log";
import {
  createSession,
  deleteSessionFile,
  listProjectSessions,
  loadSessionHistory,
  type ClaudeProjectSummary,
} from "@/lib/tauri-commands";
import type { ChatEntry, SessionInfo } from "@/lib/types";
import { useSessionStore } from "@/stores/sessionStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import styles from "./SessionsForProject.module.css";

type ListedSession = {
  key: string;
  kind: "live" | "historical";
  label: string;
  preview: string | null;
  lastTs: string | null;
  claudeSessionId: string | null;
  liveSession?: SessionInfo;
};

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

type Props = {
  projectPath: string;
};

export function SessionsForProject({ projectPath }: Props) {
  const liveOrder = useSessionStore((s) => s.order);
  const liveSessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const addSession = useSessionStore((s) => s.addSession);
  const seedEntries = useSessionStore((s) => s.seedEntries);

  const skipDeleteWarning = usePreferencesStore((s) => s.skipDeleteWarning);
  const setSkipDeleteWarning = usePreferencesStore(
    (s) => s.setSkipDeleteWarning,
  );

  const [projects, setProjects] = useState<ClaudeProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ListedSession | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setProjects(await listProjectSessions());
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

  const sessions = useMemo(() => {
    const trimmed = projectPath.trim();
    if (!trimmed) return [] as ListedSession[];

    const entries: ListedSession[] = [];

    // Historical sessions scoped to this exact cwd.
    const match = projects.find((p) => p.path === trimmed);
    if (match) {
      for (const s of match.sessions) {
        entries.push({
          key: s.id,
          kind: "historical",
          label: s.preview ?? `session ${s.id.slice(0, 8)}`,
          preview: s.preview,
          lastTs: s.lastTs,
          claudeSessionId: s.id,
        });
      }
    }

    // Live sessions that point at the same project path. Promote a
    // matching historical entry to "live" if its claude session id
    // matches, so we don't list the same conversation twice.
    for (const id of liveOrder) {
      const info = liveSessions[id];
      if (!info || info.project_path !== trimmed) continue;
      const live: ListedSession = {
        key: `live-${id}`,
        kind: "live",
        label:
          info.claude_session_id ?? `session ${id.slice(0, 8)}`,
        preview: null,
        lastTs: new Date(info.created_at * 1000).toISOString(),
        claudeSessionId: info.claude_session_id,
        liveSession: info,
      };
      const idx = entries.findIndex(
        (e) =>
          e.kind === "historical" &&
          info.claude_session_id &&
          e.claudeSessionId === info.claude_session_id,
      );
      if (idx >= 0) entries[idx] = live;
      else entries.unshift(live);
    }

    return entries.sort((a, b) => (b.lastTs ?? "").localeCompare(a.lastTs ?? ""));
  }, [projects, projectPath, liveOrder, liveSessions]);

  async function onClickSession(s: ListedSession) {
    if (s.kind === "live" && s.liveSession) {
      setActive(s.liveSession.id);
      return;
    }
    if (!s.claudeSessionId) return;
    setResuming(s.claudeSessionId);
    try {
      const info = await createSession(
        projectPath.trim(),
        null,
        s.claudeSessionId,
      );
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

  async function doDelete(s: ListedSession) {
    if (!s.claudeSessionId) return;
    try {
      await deleteSessionFile(s.claudeSessionId);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("delete session failed", msg);
      setErr(msg);
    }
  }

  function requestDelete(s: ListedSession) {
    if (skipDeleteWarning) {
      void doDelete(s);
      return;
    }
    setPendingDelete(s);
  }

  const trimmed = projectPath.trim();

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {trimmed ? "Sessions" : "No project selected"}
        </span>
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

      {!trimmed ? (
        <p className={styles.empty}>
          Enter a project path above to see its Claude Code sessions.
        </p>
      ) : sessions.length === 0 ? (
        <p className={styles.empty}>
          No sessions yet for this project. Hit “New session” above to start
          one.
        </p>
      ) : (
        <ul className={styles.list}>
          {sessions.map((s) => {
            const isActive =
              s.liveSession && s.liveSession.id === activeId;
            const isResuming =
              resuming && s.claudeSessionId === resuming;
            return (
              <li key={s.key} className={styles.item}>
                <button
                  type="button"
                  className={`${styles.sessionCard} ${
                    isActive ? styles.sessionActive : ""
                  } ${s.kind === "historical" ? styles.sessionHistorical : ""}`}
                  onClick={() => void onClickSession(s)}
                  disabled={!!isResuming}
                >
                  <MessageSquare
                    size={11}
                    className={styles.sessionIcon}
                  />
                  <div className={styles.sessionText}>
                    <span className={styles.sessionLabel}>{s.label}</span>
                    <span className={styles.sessionMeta}>
                      {s.kind === "live" ? "live · " : ""}
                      {relativeTime(s.lastTs)}
                    </span>
                  </div>
                </button>
                {s.claudeSessionId ? (
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestDelete(s);
                    }}
                    aria-label="Delete session file"
                    title="Delete from ~/.claude/projects"
                  >
                    <Trash2 size={11} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pendingDelete ? (
        <ConfirmModal
          title="Delete this session?"
          description="This permanently removes the session's JSONL file from ~/.claude/projects. The transcript, tool calls, and resume state are lost — this cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          dismissibleKey="delete-session"
          dismissed={skipDeleteWarning}
          onDismissToggle={(v) => void setSkipDeleteWarning(v)}
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            if (target) void doDelete(target);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
