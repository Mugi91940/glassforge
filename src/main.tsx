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

  // Toggle ownership is split between main.tsx and the HUD:
  //   - main.tsx handles the "hidden → open + start listening" case.
  //   - VoiceHud handles all transitions while visible (stop listening,
  //     send the draft, dismiss), because only the HUD knows its phase.
  void listen("voice://toggle", async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { invoke } = await import("@tauri-apps/api/core");
    const { availableMonitors } = await import("@tauri-apps/api/window");
    const { usePreferencesStore } = await import("@/stores/preferencesStore");

    const hud = await WebviewWindow.getByLabel("voice-hud");
    if (!hud) return;
    if (await hud.isVisible()) return;

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
    await hud.show();
    await hud.setFocus();
    const lang = usePreferencesStore.getState().voiceLang;
    await invoke("voice_start_listen", { lang });
    // Signal the HUD to reset state and flip to "listening" immediately,
    // without waiting for the first partial transcript.
    const { emit } = await import("@tauri-apps/api/event");
    void emit("voice://opened");
  });
}

void boot();
