import { useEffect } from "react";

import { MainPanel } from "@/components/layout/MainPanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useSessionEvents } from "@/hooks/useSessionEvents";
import * as log from "@/lib/log";
import { listSessions } from "@/lib/tauri-commands";
import { useLimitsStore } from "@/stores/limitsStore";
import { useSessionStore } from "@/stores/sessionStore";

import styles from "./App.module.css";

function App() {
  const setSessions = useSessionStore((s) => s.setSessions);
  const loadLimits = useLimitsStore((s) => s.load);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((e) => log.warn("list_sessions on mount failed", e));
    loadLimits().catch((e) => log.warn("limits load failed", e));
  }, [setSessions, loadLimits]);

  useSessionEvents();

  return (
    <div className={styles.root}>
      <div className={styles.ambientGlow} aria-hidden="true" />
      <div className={styles.chrome}>
        <TopBar />
        <div className={styles.body}>
          <Sidebar />
          <MainPanel />
        </div>
      </div>
    </div>
  );
}

export default App;
