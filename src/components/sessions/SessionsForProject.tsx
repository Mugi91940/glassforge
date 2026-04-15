import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessageSquare, Pencil, RefreshCw, Trash2 } from "lucide-react";

import * as log from "@/lib/log";
import {
  createSession,
  deleteSessionFile,
  listProjectSessions,
  loadSessionHistory,
  removeSession as removeBackendSession,
  type ClaudeProjectSummary,
} from "@/lib/tauri-commands";
import type { ChatEntry, SessionInfo } from "@/lib/types";
import { useSessionStore } from "@/stores/sessionStore";
import { useSessionNamesStore } from "@/stores/sessionNamesStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import styles from "./SessionsForProject.module.css";

type ListedSession = {
  key: string;
  kind: "live" | "historical";
  label: string;
  preview: string | null;
  lastTs: string | null;
  // Milliseconds since epoch used to sort the list. For live sessions we
  // use `usage.lastActivityAt` so an active conversation bubbles back to
  // the top on every event; for historical entries we fall back to the
  // JSONL `lastTs`.
  sortTs: number;
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
  const liveUsage = useSessionStore((s) => s.usage);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const addSession = useSessionStore((s) => s.addSession);
  const removeLiveSession = useSessionStore((s) => s.removeSession);
  const seedEntries = useSessionStore((s) => s.seedEntries);

  const skipDeleteWarning = usePreferencesStore((s) => s.skipDeleteWarning);
  const setSkipDeleteWarning = usePreferencesStore(
    (s) => s.setSkipDeleteWarning,
  );

  const sessionNames = useSessionNamesStore((s) => s.names);
  const renameSession = useSessionNamesStore((s) => s.rename);
  const forgetName = useSessionNamesStore((s) => s.forget);

  const [projects, setProjects] = useState<ClaudeProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ListedSession | null>(
    null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  function startEditing(s: ListedSession) {
    if (!s.claudeSessionId) return;
    setEditingId(s.claudeSessionId);
    setDraftName(sessionNames[s.claudeSessionId] ?? "");
  }

  function cancelEditing() {
    setEditingId(null);
    setDraftName("");
  }

  async function commitEditing() {
    if (!editingId) return;
    try {
      await renameSession(editingId, draftName);
    } catch (e) {
      log.warn("rename session failed", e);
    }
    cancelEditing();
  }

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

    // Use the tail of the UUID: v7 puts the timestamp at the front, so
    // sessions created in a tight burst otherwise share a prefix and all
    // look identical in the sidebar.
    const tail = (id: string) => id.replace(/-/g, "").slice(-8);
    const fallbackLabel = (claudeId: string | null, internalId?: string) => {
      if (claudeId && sessionNames[claudeId]) return sessionNames[claudeId];
      if (claudeId) return `session ${tail(claudeId)}`;
      if (internalId) return `session ${tail(internalId)}`;
      return "session";
    };

    // Historical sessions scoped to this exact cwd.
    const match = projects.find((p) => p.path === trimmed);
    if (match) {
      for (const s of match.sessions) {
        const custom = sessionNames[s.id];
        const ts = s.lastTs ? Date.parse(s.lastTs) : 0;
        entries.push({
          key: s.id,
          kind: "historical",
          label: custom ?? s.preview ?? `session ${tail(s.id)}`,
          preview: s.preview,
          lastTs: s.lastTs,
          sortTs: Number.isFinite(ts) ? ts : 0,
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
      const activityTs =
        liveUsage[id]?.lastActivityAt ?? info.created_at * 1000;
      const live: ListedSession = {
        key: `live-${id}`,
        kind: "live",
        label: fallbackLabel(info.claude_session_id, id),
        preview: null,
        lastTs: new Date(activityTs).toISOString(),
        sortTs: activityTs,
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

    return entries.sort((a, b) => b.sortTs - a.sortTs);
  }, [projects, projectPath, liveOrder, liveSessions, liveUsage, sessionNames]);

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
    try {
      // Always drop the live handle first so the PTY is killed and the
      // sidebar entry disappears immediately — even for sessions that
      // never received a claude session id (never sent a first message).
      if (s.liveSession) {
        try {
          await removeBackendSession(s.liveSession.id);
        } catch (e) {
          log.warn("remove_session backend failed", e);
        }
        removeLiveSession(s.liveSession.id);
      }
      // If the session produced a JSONL on disk, delete it too and forget
      // any custom name keyed to its claude id.
      if (s.claudeSessionId) {
        try {
          await deleteSessionFile(s.claudeSessionId);
        } catch (e) {
          // A live session that was never resumed has no JSONL — the
          // backend responds with "not found" which we can safely ignore.
          const msg = e instanceof Error ? e.message : String(e);
          if (!/not found/i.test(msg)) throw e;
        }
        await forgetName(s.claudeSessionId);
      }
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
            const isEditing =
              !!s.claudeSessionId && editingId === s.claudeSessionId;
            const hasCustomName =
              !!s.claudeSessionId && !!sessionNames[s.claudeSessionId];
            return (
              <li key={s.key} className={styles.item}>
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    className={styles.renameInput}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => void commitEditing()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitEditing();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEditing();
                      }
                    }}
                    placeholder="Session name (empty = reset)"
                    spellCheck={false}
                  />
                ) : (
                  <button
                    type="button"
                    className={`${styles.sessionCard} ${
                      isActive ? styles.sessionActive : ""
                    } ${s.kind === "historical" ? styles.sessionHistorical : ""}`}
                    onClick={() => void onClickSession(s)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEditing(s);
                    }}
                    disabled={!!isResuming}
                  >
                    <MessageSquare
                      size={11}
                      className={styles.sessionIcon}
                    />
                    <div className={styles.sessionText}>
                      <span
                        className={`${styles.sessionLabel} ${
                          hasCustomName ? styles.customName : ""
                        }`}
                      >
                        {s.label}
                      </span>
                      <span className={styles.sessionMeta}>
                        {s.kind === "live" ? "live · " : ""}
                        {relativeTime(s.lastTs)}
                      </span>
                    </div>
                  </button>
                )}
                {!isEditing ? (
                  <>
                    {s.claudeSessionId ? (
                      <button
                        type="button"
                        className={styles.renameButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(s);
                        }}
                        aria-label="Rename session"
                        title="Rename (double-click also works)"
                      >
                        <Pencil size={11} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.deleteButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(s);
                      }}
                      aria-label="Delete session"
                      title={
                        s.claudeSessionId
                          ? "Delete from ~/.claude/projects"
                          : "Close this session"
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
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
