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

  // Handle voice toggle from main window (always active, unlike hidden HUD)
  void listen("voice://toggle", async () => {
    console.log("[voice] toggle event received");
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { invoke } = await import("@tauri-apps/api/core");
    const { currentMonitor } = await import("@tauri-apps/api/window");

    const hud = await WebviewWindow.getByLabel("voice-hud");
    console.log("[voice] hud window:", hud);
    if (!hud) { console.error("[voice] voice-hud window not found"); return; }

    const isListening = await invoke<boolean>("voice_is_listening");

    if (isListening) {
      await invoke("voice_stop_listen");
      await hud.hide();
    } else {
      // Position top-center
      const monitor = await currentMonitor();
      if (monitor) {
        const x = Math.floor((monitor.size.width - 440) / 2);
        await hud.setPosition({ type: "Physical", x, y: 20 } as never);
      }
      await hud.show();
      await hud.setFocus();
      await invoke("voice_start_listen");
    }
  });
}

void boot();
