import { useEffect, useState } from "react";

import { MainPanel } from "@/components/layout/MainPanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { useSessionEvents } from "@/hooks/useSessionEvents";
import * as log from "@/lib/log";
import { listSessions } from "@/lib/tauri-commands";
import { useLimitsStore } from "@/stores/limitsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useThemeStore } from "@/stores/themeStore";

import styles from "./App.module.css";

function App() {
  const setSessions = useSessionStore((s) => s.setSessions);
  const loadLimits = useLimitsStore((s) => s.load);
  const loadTheme = useThemeStore((s) => s.load);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    loadTheme().catch((e) => log.warn("theme load failed", e));
    loadLimits().catch((e) => log.warn("limits load failed", e));
    listSessions()
      .then(setSessions)
      .catch((e) => log.warn("list_sessions on mount failed", e));
  }, [setSessions, loadLimits, loadTheme]);

  useSessionEvents();

  return (
    <div className={styles.root}>
      <div className={styles.ambientGlow} aria-hidden="true" />
      <div className={styles.chrome}>
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <div className={styles.body}>
          <Sidebar />
          <MainPanel />
        </div>
      </div>
      {settingsOpen ? (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  );
}

export default App;
