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

  // main.tsx is the single listener on voice://toggle. If the HUD is
  // hidden we open it and start listening here. If it's visible we
  // forward a distinct voice://toggle-visible event that only the HUD
  // listens to — this prevents a race where the HUD listener fires
  // immediately after hud.show() and dismisses the freshly-opened HUD.
  let isPositioned = false;
  void listen("voice://toggle", async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { invoke } = await import("@tauri-apps/api/core");
    const { availableMonitors } = await import("@tauri-apps/api/window");
    const { usePreferencesStore } = await import("@/stores/preferencesStore");
    const { emit } = await import("@tauri-apps/api/event");

    const hud = await WebviewWindow.getByLabel("voice-hud");
    if (!hud) return;

    if (await hud.isVisible()) {
      void emit("voice://toggle-visible");
      return;
    }

    // Only center the HUD the first time — respect the user's chosen
    // position on subsequent opens.
    if (!isPositioned) {
      const monitors = await availableMonitors();
      const target = monitors.find((m) => m.name === "DP-1") ?? monitors[0];
      if (target) {
        const x = target.position.x + Math.floor((target.size.width - 560) / 2);
        await hud.setPosition({
          type: "Physical",
          x,
          y: target.position.y + 20,
        } as never);
      }
      isPositioned = true;
    }
    await hud.show();
    await hud.setFocus();
    const lang = usePreferencesStore.getState().voiceLang;
    await invoke("voice_start_listen", { lang });
    void emit("voice://opened");
  });
}

void boot();
