import { invoke } from "@tauri-apps/api/core";
import type { SessionInfo } from "./types";

export async function healthCheck(): Promise<string> {
  return invoke<string>("health_check");
}

export async function createSession(
  projectPath: string,
  model?: string | null,
  claudeSessionId?: string | null,
): Promise<SessionInfo> {
  return invoke<SessionInfo>("create_session", {
    projectPath,
    model: model ?? null,
    claudeSessionId: claudeSessionId ?? null,
  });
}

export type ClaudeSessionSummary = {
  id: string;
  projectPath: string;
  firstTs: string | null;
  lastTs: string | null;
  messageCount: number;
  preview: string | null;
  model: string | null;
};

export type ClaudeProjectSummary = {
  path: string;
  sessions: ClaudeSessionSummary[];
};

export async function listProjectSessions(): Promise<ClaudeProjectSummary[]> {
  return invoke<ClaudeProjectSummary[]>("list_project_sessions");
}

export async function loadSessionHistory(
  sessionId: string,
): Promise<unknown[]> {
  return invoke<unknown[]>("load_session_history", { sessionId });
}

export type PermissionMode =
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "manual";

export async function sendMessage(
  sessionId: string,
  message: string,
  model?: string | null,
  permissionMode?: PermissionMode | null,
): Promise<void> {
  return invoke<void>("send_message", {
    sessionId,
    message,
    model: model ?? null,
    permissionMode: permissionMode ?? null,
  });
}

export type PermissionDecision = "allow" | "allowSession" | "deny";

export async function resolvePermission(
  sessionId: string,
  requestId: string,
  decision: PermissionDecision,
): Promise<void> {
  return invoke<void>("resolve_permission", {
    sessionId,
    requestId,
    decision,
  });
}

export type PermissionRequest = {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
};

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
  last5h: ClaudeUsageTotals;
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

export type RateLimitBucket = {
  usedPercentage: number;
  resetsAt: string | null;
};

export type RateLimits = {
  fiveHour: RateLimitBucket | null;
  sevenDay: RateLimitBucket | null;
  sevenDayOpus: RateLimitBucket | null;
  sevenDaySonnet: RateLimitBucket | null;
  capturedAtIso: string | null;
  staleSeconds: number;
};

export async function getRateLimits(): Promise<RateLimits | null> {
  return invoke<RateLimits | null>("get_rate_limits");
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
