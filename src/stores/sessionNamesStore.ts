import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";

import * as log from "@/lib/log";

const STORE_FILE = "settings.json";
const KEY = "sessionNames";

let storeInstance: LazyStore | null = null;
function getStore(): LazyStore {
  if (!storeInstance) storeInstance = new LazyStore(STORE_FILE);
  return storeInstance;
}

type SessionNamesState = {
  names: Record<string, string>;
  loaded: boolean;
  load: () => Promise<void>;
  rename: (claudeSessionId: string, name: string) => Promise<void>;
  forget: (claudeSessionId: string) => Promise<void>;
};

async function persist(next: Record<string, string>): Promise<void> {
  try {
    const s = getStore();
    await s.set(KEY, next);
    await s.save();
  } catch (e) {
    log.warn("sessionNames save failed", e);
  }
}

export const useSessionNamesStore = create<SessionNamesState>((set, get) => ({
  names: {},
  loaded: false,

  load: async () => {
    try {
      const s = getStore();
      const raw = (await s.get<Record<string, string>>(KEY)) ?? null;
      const names: Record<string, string> = {};
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === "string" && v.trim()) names[k] = v;
        }
      }
      set({ names, loaded: true });
    } catch (e) {
      log.warn("sessionNames load failed", e);
      set({ loaded: true });
    }
  },

  rename: async (claudeSessionId, name) => {
    const trimmed = name.trim();
    const next = { ...get().names };
    if (trimmed) {
      next[claudeSessionId] = trimmed;
    } else {
      delete next[claudeSessionId];
    }
    set({ names: next });
    await persist(next);
  },

  forget: async (claudeSessionId) => {
    const next = { ...get().names };
    if (!(claudeSessionId in next)) return;
    delete next[claudeSessionId];
    set({ names: next });
    await persist(next);
  },
}));
