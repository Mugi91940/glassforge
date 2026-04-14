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
  model?: string | null,
): Promise<void> {
  return invoke<void>("send_message", {
    sessionId,
    message,
    model: model ?? null,
  });
}

export async function killSession(sessionId: string): Promise<void> {
  return invoke<void>("kill_session", { sessionId });
}

export async function removeSession(sessionId: string): Promise<void> {
  return invoke<void>("remove_session", { sessionId });
}

export async function listSessions(): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("list_sessions");
}

export type ClaudeUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  messages: number;
};

export type ClaudeUsageSnapshot = {
  today: ClaudeUsageTotals;
  last7d: ClaudeUsageTotals;
  allTime: ClaudeUsageTotals;
  byModel: { model: string; totals: ClaudeUsageTotals }[];
  lastActivityIso: string | null;
  sessionCount: number;
};

export async function getClaudeUsage(): Promise<ClaudeUsageSnapshot> {
  return invoke<ClaudeUsageSnapshot>("get_claude_usage");
}

export async function setKdeBlur(enabled: boolean): Promise<void> {
  return invoke<void>("set_kde_blur", { enabled });
}

export async function setKdeBlurStrength(strength: number): Promise<void> {
  return invoke<void>("set_kde_blur_strength", {
    strength: Math.max(1, Math.min(15, Math.round(strength))),
  });
}

export type DisplayServer = "wayland" | "x11" | "unknown" | "unsupported";

export async function detectDisplayServer(): Promise<DisplayServer> {
  return invoke<DisplayServer>("detect_display_server");
}
