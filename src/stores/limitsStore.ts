import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";

import * as log from "@/lib/log";

export type LimitsConfig = {
  weeklyTokenBudget: number;
  dailyMessageBudget: number;
  opusHourlyBudget: number;
  maxConcurrentSessions: number;
};

const DEFAULTS: LimitsConfig = {
  weeklyTokenBudget: 50_000_000,
  dailyMessageBudget: 500,
  opusHourlyBudget: 50,
  maxConcurrentSessions: 8,
};

const STORE_FILE = "settings.json";
const KEY = "limits";

type LimitsState = {
  config: LimitsConfig;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<LimitsConfig>) => Promise<void>;
};

let storeInstance: LazyStore | null = null;

function getStore(): LazyStore {
  if (!storeInstance) storeInstance = new LazyStore(STORE_FILE);
  return storeInstance;
}

export const useLimitsStore = create<LimitsState>((set, get) => ({
  config: DEFAULTS,
  loaded: false,

  load: async () => {
    try {
      const store = getStore();
      const saved = await store.get<Partial<LimitsConfig>>(KEY);
      if (saved && typeof saved === "object") {
        set({ config: { ...DEFAULTS, ...saved }, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch (e) {
      log.warn("limits load failed", e);
      set({ loaded: true });
    }
  },

  update: async (patch) => {
    const next = { ...get().config, ...patch };
    set({ config: next });
    try {
      const store = getStore();
      await store.set(KEY, next);
      await store.save();
    } catch (e) {
      log.warn("limits save failed", e);
    }
  },
}));
