import type { ChatEntry } from "@/lib/types";
import { useSessionStore } from "@/stores/sessionStore";
import { ChatView } from "@/components/sessions/ChatView";
import { ComposeInput } from "@/components/sessions/ComposeInput";
import { PermissionModal } from "@/components/sessions/PermissionModal";

import styles from "./MainPanel.module.css";

// Stable module-level empty array: returning `[]` from a selector on every
// call creates a new reference, which trips zustand's useSyncExternalStore
// into thinking the snapshot changed, producing an infinite update loop
// (React error #185). Use one frozen reference for the "no entries" case.
const EMPTY_ENTRIES: readonly ChatEntry[] = Object.freeze([]);

export function MainPanel() {
  const activeId = useSessionStore((s) => s.activeId);
  const activeSession = useSessionStore((s) =>
    s.activeId ? (s.sessions[s.activeId] ?? null) : null,
  );
  const activeEntries = useSessionStore((s) =>
    s.activeId ? (s.entries[s.activeId] ?? EMPTY_ENTRIES) : EMPTY_ENTRIES,
  ) as ChatEntry[];

  void activeId;
  if (!activeSession) {
    return (
      <main className={styles.root}>
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>No session selected</h2>
          <p className={styles.emptySubtitle}>
            Create a new session from the sidebar, or press Ctrl+N
          </p>
        </div>
      </main>
    );
  }

  // Every send_message spawns a fresh `claude -p` child and flips the
  // status back to Running, so an "error" status only reflects the
  // previous turn — never a permanent lockout. Keep the composer live so
  // the user can always retry (claude's own /compact leaves the process
  // in an exit state that we used to misread as a dead session).
  return (
    <main className={styles.root}>
      <ChatView session={activeSession} entries={activeEntries} />
      <ComposeInput sessionId={activeSession.id} />
      <PermissionModal sessionId={activeSession.id} />
    </main>
  );
}
