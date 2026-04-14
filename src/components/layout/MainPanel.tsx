import { useShallow } from "zustand/react/shallow";

import { useSessionStore } from "@/stores/sessionStore";
import { ChatView } from "@/components/sessions/ChatView";
import { ComposeInput } from "@/components/sessions/ComposeInput";

import styles from "./MainPanel.module.css";

export function MainPanel() {
  const { activeSession, activeEntries } = useSessionStore(
    useShallow((s) => ({
      activeSession: s.activeId ? s.sessions[s.activeId] : null,
      activeEntries: s.activeId ? (s.entries[s.activeId] ?? []) : [],
    })),
  );

  if (!activeSession) {
    return (
      <main className={styles.root}>
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>No active session</h2>
          <p className={styles.emptySubtitle}>
            Spawn a new Claude Code session from the sidebar to get started.
          </p>
        </div>
      </main>
    );
  }

  const disabled =
    activeSession.status === "done" || activeSession.status === "error";

  return (
    <main className={styles.root}>
      <ChatView session={activeSession} entries={activeEntries} />
      <ComposeInput sessionId={activeSession.id} disabled={disabled} />
    </main>
  );
}
