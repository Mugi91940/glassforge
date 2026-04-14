import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";

import * as log from "@/lib/log";
import { applyTheme, DEFAULT_THEME, PRESETS, type ThemeVars } from "@/lib/theme";

const STORE_FILE = "settings.json";
const KEY = "theme";

let storeInstance: LazyStore | null = null;
function getStore(): LazyStore {
  if (!storeInstance) storeInstance = new LazyStore(STORE_FILE);
  return storeInstance;
}

type ThemeState = {
  vars: ThemeVars;
  presetId: string;
  loaded: boolean;

  load: () => Promise<void>;
  setPreset: (id: string) => Promise<void>;
  patch: (delta: Partial<ThemeVars>) => Promise<void>;
  reset: () => Promise<void>;
};

type Persisted = {
  vars: ThemeVars;
  presetId: string;
};

async function persist(next: Persisted): Promise<void> {
  try {
    const s = getStore();
    await s.set(KEY, next);
    await s.save();
  } catch (e) {
    log.warn("theme save failed", e);
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  vars: DEFAULT_THEME,
  presetId: "dark-glass",
  loaded: false,

  load: async () => {
    try {
      const s = getStore();
      const saved = await s.get<Partial<Persisted>>(KEY);
      if (saved?.vars) {
        const vars: ThemeVars = { ...DEFAULT_THEME, ...saved.vars };
        set({
          vars,
          presetId: saved.presetId ?? "custom",
          loaded: true,
        });
        applyTheme(vars);
        return;
      }
    } catch (e) {
      log.warn("theme load failed", e);
    }
    applyTheme(DEFAULT_THEME);
    set({ loaded: true });
  },

  setPreset: async (id) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const next = { vars: { ...preset.vars }, presetId: id };
    set(next);
    applyTheme(next.vars);
    await persist(next);
  },

  patch: async (delta) => {
    const next = { vars: { ...get().vars, ...delta }, presetId: "custom" };
    set(next);
    applyTheme(next.vars);
    await persist(next);
  },

  reset: async () => {
    const next = { vars: DEFAULT_THEME, presetId: "dark-glass" };
    set(next);
    applyTheme(DEFAULT_THEME);
    await persist(next);
  },
}));
