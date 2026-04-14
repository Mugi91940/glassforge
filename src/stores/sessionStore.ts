import { create } from "zustand";

import { stripAnsi } from "@/lib/ansi";
import type {
  SessionEntry,
  SessionInfo,
  SessionStatus,
} from "@/lib/types";

export type SessionUsage = {
  bytesIn: number;
  bytesOut: number;
  messages: number;
  startedAt: number;
  lastActivityAt: number;
};

function emptyUsage(): SessionUsage {
  const now = Date.now();
  return {
    bytesIn: 0,
    bytesOut: 0,
    messages: 0,
    startedAt: now,
    lastActivityAt: now,
  };
}

type SessionState = {
  sessions: Record<string, SessionInfo>;
  entries: Record<string, SessionEntry[]>;
  usage: Record<string, SessionUsage>;
  activeId: string | null;
  order: string[];

  setSessions: (sessions: SessionInfo[]) => void;
  addSession: (info: SessionInfo) => void;
  updateStatus: (id: string, status: SessionStatus) => void;
  appendStdout: (id: string, data: string) => void;
  appendUser: (id: string, text: string) => void;
  appendSystem: (id: string, text: string) => void;
  setActive: (id: string | null) => void;
  removeSession: (id: string) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  sessions: {},
  entries: {},
  usage: {},
  activeId: null,
  order: [],

  setSessions: (list) =>
    set(() => {
      const sessions: Record<string, SessionInfo> = {};
      const entries: Record<string, SessionEntry[]> = {};
      const usage: Record<string, SessionUsage> = {};
      const order: string[] = [];
      for (const info of list) {
        sessions[info.id] = info;
        entries[info.id] = [];
        usage[info.id] = emptyUsage();
        order.push(info.id);
      }
      return { sessions, entries, usage, order, activeId: order[0] ?? null };
    }),

  addSession: (info) =>
    set((s) => ({
      sessions: { ...s.sessions, [info.id]: info },
      entries: { ...s.entries, [info.id]: s.entries[info.id] ?? [] },
      usage: { ...s.usage, [info.id]: s.usage[info.id] ?? emptyUsage() },
      order: s.order.includes(info.id) ? s.order : [...s.order, info.id],
      activeId: s.activeId ?? info.id,
    })),

  updateStatus: (id, status) =>
    set((s) => {
      const current = s.sessions[id];
      if (!current) return {};
      return { sessions: { ...s.sessions, [id]: { ...current, status } } };
    }),

  appendStdout: (id, data) =>
    set((s) => {
      const cleaned = stripAnsi(data);
      if (!cleaned) return {};
      const existing = s.entries[id] ?? [];
      const last = existing[existing.length - 1];

      const prevUsage = s.usage[id] ?? emptyUsage();
      const nextUsage: SessionUsage = {
        ...prevUsage,
        bytesIn: prevUsage.bytesIn + cleaned.length,
        lastActivityAt: Date.now(),
      };

      let nextEntries: SessionEntry[];
      if (last && last.kind === "stdout") {
        const merged: SessionEntry = { ...last, text: last.text + cleaned };
        nextEntries = [...existing.slice(0, -1), merged];
      } else {
        nextEntries = [
          ...existing,
          { kind: "stdout", ts: Date.now(), text: cleaned },
        ];
      }

      return {
        entries: { ...s.entries, [id]: nextEntries },
        usage: { ...s.usage, [id]: nextUsage },
      };
    }),

  appendUser: (id, text) =>
    set((s) => {
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
          [id]: [
            ...(s.entries[id] ?? []),
            { kind: "user", ts: Date.now(), text },
          ],
        },
        usage: { ...s.usage, [id]: nextUsage },
      };
    }),

  appendSystem: (id, text) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [id]: [
          ...(s.entries[id] ?? []),
          { kind: "system", ts: Date.now(), text },
        ],
      },
    })),

  setActive: (id) => set({ activeId: id }),

  removeSession: (id) =>
    set((s) => {
      const sessions = { ...s.sessions };
      const entries = { ...s.entries };
      const usage = { ...s.usage };
      delete sessions[id];
      delete entries[id];
      delete usage[id];
      const order = s.order.filter((x) => x !== id);
      const nextActive =
        s.activeId === id ? (order[0] ?? null) : s.activeId;
      return { sessions, entries, usage, order, activeId: nextActive };
    }),
}));
