import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import "./styles/global.css";
import "./styles/theme.css";

async function boot() {
  const win = getCurrentWebviewWindow();
  const root = document.getElementById("root")!;

  if (win.label === "voice-hud") {
    const { VoiceHud } = await import("@/voice-hud/VoiceHud");
    createRoot(root).render(
      <StrictMode>
        <VoiceHud />
      </StrictMode>,
    );
    return;
  }

  const { default: App } = await import("./App");
  const { listen } = await import("@tauri-apps/api/event");

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Relay voice events that need main-window context
  void listen<{ command: string }>("voice://command", ({ payload }) => {
    window.dispatchEvent(new CustomEvent("voice:command", { detail: payload.command }));
  });

  void listen<{ text: string }>("voice://send_message", ({ payload }) => {
    window.dispatchEvent(new CustomEvent("voice:send_message", { detail: payload.text }));
  });

  // Handle voice toggle from main window (HUD is hidden by default and can't receive events)
  void listen("voice://toggle", async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { invoke } = await import("@tauri-apps/api/core");
    const { availableMonitors } = await import("@tauri-apps/api/window");
    const { usePreferencesStore } = await import("@/stores/preferencesStore");

    const hud = await WebviewWindow.getByLabel("voice-hud");
    if (!hud) return;

    const isVisible = await hud.isVisible();

    if (isVisible) {
      await invoke("voice_stop_listen").catch(() => {});
      await hud.hide();
    } else {
      const monitors = await availableMonitors();
      const target = monitors.find((m) => m.name === "DP-1") ?? monitors[0];
      if (target) {
        const x = target.position.x + Math.floor((target.size.width - 440) / 2);
        await hud.setPosition({ type: "Physical", x, y: target.position.y + 20 } as never);
      }
      await hud.show();
      await hud.setFocus();
      const lang = usePreferencesStore.getState().voiceLang;
      await invoke("voice_start_listen", { lang });
    }
  });
}

void boot();
