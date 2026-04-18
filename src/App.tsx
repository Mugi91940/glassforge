import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { MainPanel } from "@/components/layout/MainPanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSessionEvents } from "@/hooks/useSessionEvents";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { useVoicePermission } from "@/hooks/useVoicePermission";
import { useVoiceResponse } from "@/hooks/useVoiceResponse";
import * as log from "@/lib/log";
import { listSessions } from "@/lib/tauri-commands";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionNamesStore } from "@/stores/sessionNamesStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useThemeStore } from "@/stores/themeStore";

import styles from "./App.module.css";

function App() {
  const setSessions = useSessionStore((s) => s.setSessions);
  const loadTheme = useThemeStore((s) => s.load);
  const loadPrefs = usePreferencesStore((s) => s.load);
  const loadNames = useSessionNamesStore((s) => s.load);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    loadTheme().catch((e) => log.warn("theme load failed", e));
    // After prefs load, push the saved voice model to the sidecar so it
    // stops using its internal default and loads the right weights up
    // front (first use of a large model downloads ~1.5 GB, so we'd rather
    // pay that now than in the middle of a dictation turn).
    loadPrefs()
      .then(() => {
        const model = usePreferencesStore.getState().voiceModel;
        invoke("voice_set_model", { model }).catch((e) =>
          log.warn("voice_set_model on boot failed", e),
        );
      })
      .catch((e) => log.warn("preferences load failed", e));
    loadNames().catch((e) => log.warn("sessionNames load failed", e));
    listSessions()
      .then(setSessions)
      .catch((e) => log.warn("list_sessions on mount failed", e));
  }, [setSessions, loadTheme, loadPrefs, loadNames]);

  useSessionEvents();
  useVoiceResponse();
  useVoiceConversation();
  useVoicePermission();
  useKeyboardShortcuts({ settingsOpen, setSettingsOpen });

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
