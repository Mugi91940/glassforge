import { create } from "zustand";

import type {
  AssistantMessage,
  ChatEntry,
  ClaudeEvent,
  ContentBlock,
  SessionInfo,
  SessionStatus,
} from "@/lib/types";

export type SessionUsage = {
  bytesIn: number;
  bytesOut: number;
  messages: number;
  totalCostUsd: number;
  startedAt: number;
  lastActivityAt: number;
};

function emptyUsage(): SessionUsage {
  const now = Date.now();
  return {
    bytesIn: 0,
    bytesOut: 0,
    messages: 0,
    totalCostUsd: 0,
    startedAt: now,
    lastActivityAt: now,
  };
}

export type PendingPermission = {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  receivedAt: number;
};

type SessionState = {
  sessions: Record<string, SessionInfo>;
  entries: Record<string, ChatEntry[]>;
  usage: Record<string, SessionUsage>;
  pendingPermissions: Record<string, PendingPermission[]>;
  activeId: string | null;
  order: string[];

  setSessions: (sessions: SessionInfo[]) => void;
  addSession: (info: SessionInfo) => void;
  updateSession: (id: string, patch: Partial<SessionInfo>) => void;
  updateStatus: (id: string, status: SessionStatus) => void;
  handleClaudeEvent: (id: string, event: ClaudeEvent) => void;
  appendUser: (id: string, text: string) => void;
  setActive: (id: string | null) => void;
  removeSession: (id: string) => void;
  pushPermission: (sessionId: string, req: PendingPermission) => void;
  resolvePermission: (sessionId: string, requestId: string) => void;
  clearPermissions: (sessionId: string) => void;
  seedEntries: (sessionId: string, entries: ChatEntry[]) => void;
};

// Helper: extract text from a list of content blocks.
function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// Helper: stringify a tool_result content (can be string or nested blocks).
function toolResultText(
  content: string | ContentBlock[] | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((b) => {
      if (b.type === "text") {
        return (b as { text: string }).text;
      }
      try {
        return JSON.stringify(b);
      } catch {
        return String(b);
      }
    })
    .join("\n");
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: {},
  entries: {},
  usage: {},
  pendingPermissions: {},
  activeId: null,
  order: [],

  setSessions: (list) =>
    set(() => {
      const sessions: Record<string, SessionInfo> = {};
      const entries: Record<string, ChatEntry[]> = {};
      const usage: Record<string, SessionUsage> = {};
      const order: string[] = [];
      for (const info of list) {
        sessions[info.id] = info;
        entries[info.id] = [];
        usage[info.id] = emptyUsage();
        order.push(info.id);
      }
      return {
        sessions,
        entries,
        usage,
        order,
        activeId: order[0] ?? null,
      };
    }),

  addSession: (info) =>
    set((s) => ({
      sessions: { ...s.sessions, [info.id]: info },
      entries: { ...s.entries, [info.id]: s.entries[info.id] ?? [] },
      usage: { ...s.usage, [info.id]: s.usage[info.id] ?? emptyUsage() },
      order: s.order.includes(info.id) ? s.order : [...s.order, info.id],
      activeId: s.activeId ?? info.id,
    })),

  updateSession: (id, patch) =>
    set((s) => {
      const current = s.sessions[id];
      if (!current) return {};
      return { sessions: { ...s.sessions, [id]: { ...current, ...patch } } };
    }),

  updateStatus: (id, status) =>
    set((s) => {
      const current = s.sessions[id];
      if (!current) return {};
      return { sessions: { ...s.sessions, [id]: { ...current, status } } };
    }),

  appendUser: (id, text) =>
    set((s) => {
      const prev = s.entries[id] ?? [];
      const prevUsage = s.usage[id] ?? emptyUsage();
      const nextUsage: SessionUsage = {
        ...prevUsage,
        bytesOut: prevUsage.bytesOut + text.length,
        messages: prevUsage.messages + 1,
        lastActivityAt: Date.now(),
      };
      return {
        entries: {
          ...s.entries,
          [id]: [...prev, { kind: "user", ts: Date.now(), text }],
        },
        usage: { ...s.usage, [id]: nextUsage },
      };
    }),

  handleClaudeEvent: (id, event) =>
    set((s) => {
      const prev = s.entries[id] ?? [];
      const prevUsage = s.usage[id] ?? emptyUsage();
      const now = Date.now();
      const touchActivity = (u: SessionUsage): SessionUsage => ({
        ...u,
        lastActivityAt: now,
      });

      const t = (event as { type?: string }).type;

      if (t === "user_text") {
        const text = (event as { text?: string }).text ?? "";
        return {
          entries: {
            ...s.entries,
            [id]: [...prev, { kind: "user", ts: now, text }],
          },
          usage: {
            ...s.usage,
            [id]: {
              ...touchActivity(prevUsage),
              bytesOut: prevUsage.bytesOut + text.length,
              messages: prevUsage.messages + 1,
            },
          },
        };
      }

      if (t === "stderr") {
        const text = (event as { text?: string }).text ?? "";
        if (!text.trim()) return {};
        return {
          entries: {
            ...s.entries,
            [id]: [...prev, { kind: "error", ts: now, text }],
          },
        };
      }

      if (t === "raw") {
        const text = (event as { text?: string }).text ?? "";
        if (!text.trim()) return {};
        return {
          entries: {
            ...s.entries,
            [id]: [...prev, { kind: "system", ts: now, text }],
          },
        };
      }

      if (t === "system") {
        // Mostly init metadata; we capture it silently.
        return {};
      }

      if (t === "assistant") {
        const msg = (event as { message?: AssistantMessage }).message;
        if (!msg) return {};
        const next: ChatEntry[] = [...prev];
        for (const block of msg.content ?? []) {
          if (block.type === "text") {
            const text = (block as { text: string }).text;
            next.push({
              kind: "assistant",
              ts: now,
              text,
              model: msg.model,
              usage: msg.usage
                ? {
                    input_tokens: msg.usage.input_tokens ?? 0,
                    output_tokens: msg.usage.output_tokens ?? 0,
                  }
                : undefined,
            });
          } else if (block.type === "tool_use") {
            const tu = block as {
              id: string;
              name: string;
              input: unknown;
            };
            next.push({
              kind: "tool",
              ts: now,
              id: tu.id,
              name: tu.name,
              input: tu.input,
            });
          } else if (block.type === "thinking") {
            // Skip thinking blocks for now.
          }
        }
        const bytesIn =
          prevUsage.bytesIn +
          next
            .slice(prev.length)
            .reduce(
              (acc, e) =>
                acc + (e.kind === "assistant" ? e.text.length : 0),
              0,
            );
        return {
          entries: { ...s.entries, [id]: next },
          usage: {
            ...s.usage,
            [id]: { ...touchActivity(prevUsage), bytesIn },
          },
        };
      }

      if (t === "user") {
        // Claude echoes back user messages that contain tool_result blocks.
        const msg = (event as { message?: { content?: ContentBlock[] } })
          .message;
        if (!msg?.content) return {};
        const next: ChatEntry[] = [...prev];
        for (const block of msg.content) {
          if (block.type === "tool_result") {
            const tr = block as {
              tool_use_id: string;
              content: string | ContentBlock[];
              is_error?: boolean;
            };
            const resultText = toolResultText(tr.content);
            // Attach to an existing tool entry if we can find it.
            let attached = false;
            for (let i = next.length - 1; i >= 0; i--) {
              const e = next[i];
              if (e.kind === "tool" && e.id === tr.tool_use_id) {
                next[i] = {
                  ...e,
                  result: resultText,
                  isError: tr.is_error,
                };
                attached = true;
                break;
              }
            }
            if (!attached) {
              next.push({
                kind: "tool",
                ts: now,
                id: tr.tool_use_id,
                name: "(unknown)",
                input: undefined,
                result: resultText,
                isError: tr.is_error,
              });
            }
          } else if (block.type === "text") {
            const text = (block as { text: string }).text;
            if (text.trim()) {
              next.push({ kind: "assistant", ts: now, text });
            }
          }
        }
        return {
          entries: { ...s.entries, [id]: next },
          usage: { ...s.usage, [id]: touchActivity(prevUsage) },
        };
      }

      if (t === "result") {
        const r = event as {
          cost_usd?: number;
          total_cost_usd?: number;
          duration_ms?: number;
          num_turns?: number;
        };
        const cost = r.total_cost_usd ?? r.cost_usd;
        return {
          entries: {
            ...s.entries,
            [id]: [
              ...prev,
              {
                kind: "result",
                ts: now,
                costUsd: cost,
                durationMs: r.duration_ms,
                numTurns: r.num_turns,
              },
            ],
          },
          usage: {
            ...s.usage,
            [id]: {
              ...touchActivity(prevUsage),
              totalCostUsd: prevUsage.totalCostUsd + (cost ?? 0),
            },
          },
        };
      }

      // Unknown event — ignore silently.
      // `blocksToText` is exported for callers that want the plain-text
      // version of a content-block array.
      void blocksToText;
      return {};
    }),

  setActive: (id) => set({ activeId: id }),

  removeSession: (id) =>
    set((s) => {
      const sessions = { ...s.sessions };
      const entries = { ...s.entries };
      const usage = { ...s.usage };
      const pendingPermissions = { ...s.pendingPermissions };
      delete sessions[id];
      delete entries[id];
      delete usage[id];
      delete pendingPermissions[id];
      const order = s.order.filter((x) => x !== id);
      const nextActive =
        s.activeId === id ? (order[0] ?? null) : s.activeId;
      return {
        sessions,
        entries,
        usage,
        pendingPermissions,
        order,
        activeId: nextActive,
      };
    }),

  pushPermission: (sessionId, req) =>
    set((s) => {
      const prev = s.pendingPermissions[sessionId] ?? [];
      return {
        pendingPermissions: {
          ...s.pendingPermissions,
          [sessionId]: [...prev, req],
        },
      };
    }),

  resolvePermission: (sessionId, requestId) =>
    set((s) => {
      const prev = s.pendingPermissions[sessionId] ?? [];
      return {
        pendingPermissions: {
          ...s.pendingPermissions,
          [sessionId]: prev.filter((p) => p.requestId !== requestId),
        },
      };
    }),

  clearPermissions: (sessionId) =>
    set((s) => ({
      pendingPermissions: { ...s.pendingPermissions, [sessionId]: [] },
    })),

  seedEntries: (sessionId, nextEntries) =>
    set((s) => ({
      entries: { ...s.entries, [sessionId]: nextEntries },
    })),
}));
