import { invoke } from "@tauri-apps/api/core";
import type { SessionInfo } from "./types";

export async function healthCheck(): Promise<string> {
  return invoke<string>("health_check");
}

export async function createSession(
  projectPath: string,
  model?: string | null,
): Promise<SessionInfo> {
  return invoke<SessionInfo>("create_session", {
    projectPath,
    model: model ?? null,
  });
}

export async function sendMessage(
  sessionId: string,
  message: string,
): Promise<void> {
  return invoke<void>("send_message", { sessionId, message });
}

export async function killSession(sessionId: string): Promise<void> {
  return invoke<void>("kill_session", { sessionId });
}

export async function listSessions(): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("list_sessions");
}

export async function setKdeBlur(enabled: boolean): Promise<void> {
  return invoke<void>("set_kde_blur", { enabled });
}

export type DisplayServer = "wayland" | "x11" | "unknown" | "unsupported";

export async function detectDisplayServer(): Promise<DisplayServer> {
  return invoke<DisplayServer>("detect_display_server");
}
