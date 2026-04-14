import { create } from "zustand";

import { stripAnsi } from "@/lib/ansi";
import type {
  SessionEntry,
  SessionInfo,
  SessionStatus,
} from "@/lib/types";

type SessionState = {
  sessions: Record<string, SessionInfo>;
  entries: Record<string, SessionEntry[]>;
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
  activeId: null,
  order: [],

  setSessions: (list) =>
    set(() => {
      const sessions: Record<string, SessionInfo> = {};
      const entries: Record<string, SessionEntry[]> = {};
      const order: string[] = [];
      for (const info of list) {
        sessions[info.id] = info;
        entries[info.id] = [];
        order.push(info.id);
      }
      return {
        sessions,
        entries,
        order,
        activeId: order[0] ?? null,
      };
    }),

  addSession: (info) =>
    set((s) => ({
      sessions: { ...s.sessions, [info.id]: info },
      entries: { ...s.entries, [info.id]: s.entries[info.id] ?? [] },
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
      if (last && last.kind === "stdout") {
        const merged: SessionEntry = { ...last, text: last.text + cleaned };
        return {
          entries: {
            ...s.entries,
            [id]: [...existing.slice(0, -1), merged],
          },
        };
      }
      return {
        entries: {
          ...s.entries,
          [id]: [
            ...existing,
            { kind: "stdout", ts: Date.now(), text: cleaned },
          ],
        },
      };
    }),

  appendUser: (id, text) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [id]: [
          ...(s.entries[id] ?? []),
          { kind: "user", ts: Date.now(), text },
        ],
      },
    })),

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
      delete sessions[id];
      delete entries[id];
      const order = s.order.filter((x) => x !== id);
      const nextActive =
        s.activeId === id ? (order[0] ?? null) : s.activeId;
      return { sessions, entries, order, activeId: nextActive };
    }),
}));
