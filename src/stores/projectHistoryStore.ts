import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";

import * as log from "@/lib/log";

export type ProjectEntry = {
  path: string;
  lastUsed: number;
};

const STORE_FILE = "settings.json";
const KEY = "projectHistory";
const MAX = 12;

let storeInstance: LazyStore | null = null;
function getStore(): LazyStore {
  if (!storeInstance) storeInstance = new LazyStore(STORE_FILE);
  return storeInstance;
}

type State = {
  projects: ProjectEntry[];
  loaded: boolean;
  load: () => Promise<void>;
  touch: (path: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  clear: () => Promise<void>;
};

async function persist(projects: ProjectEntry[]): Promise<void> {
  try {
    const s = getStore();
    await s.set(KEY, projects);
    await s.save();
  } catch (e) {
    log.warn("projectHistory save failed", e);
  }
}

export const useProjectHistoryStore = create<State>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    try {
      const s = getStore();
      const saved = await s.get<ProjectEntry[]>(KEY);
      if (Array.isArray(saved)) {
        const clean = saved
          .filter(
            (p): p is ProjectEntry =>
              typeof p === "object" &&
              p !== null &&
              typeof p.path === "string" &&
              typeof p.lastUsed === "number",
          )
          .slice(0, MAX);
        set({ projects: clean, loaded: true });
        return;
      }
    } catch (e) {
      log.warn("projectHistory load failed", e);
    }
    set({ loaded: true });
  },

  touch: async (path) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const now = Date.now();
    const current = get().projects.filter((p) => p.path !== trimmed);
    const next: ProjectEntry[] = [
      { path: trimmed, lastUsed: now },
      ...current,
    ].slice(0, MAX);
    set({ projects: next });
    await persist(next);
  },

  remove: async (path) => {
    const next = get().projects.filter((p) => p.path !== path);
    set({ projects: next });
    await persist(next);
  },

  clear: async () => {
    set({ projects: [] });
    await persist([]);
  },
}));
