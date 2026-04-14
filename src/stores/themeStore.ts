import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";

import * as log from "@/lib/log";
import { setKdeBlur } from "@/lib/tauri-commands";
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

async function syncKdeBlur(enabled: boolean): Promise<void> {
  try {
    await setKdeBlur(enabled);
  } catch (e) {
    log.warn("set_kde_blur failed", e);
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
        if (vars.kdeBlurEnabled) await syncKdeBlur(true);
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
    const prev = get().vars;
    const next = { vars: { ...preset.vars }, presetId: id };
    set(next);
    applyTheme(next.vars);
    await persist(next);
    if (prev.kdeBlurEnabled !== next.vars.kdeBlurEnabled) {
      await syncKdeBlur(next.vars.kdeBlurEnabled);
    }
  },

  patch: async (delta) => {
    const prev = get().vars;
    const next = { vars: { ...prev, ...delta }, presetId: "custom" };
    set(next);
    applyTheme(next.vars);
    await persist(next);
    if (
      delta.kdeBlurEnabled !== undefined &&
      delta.kdeBlurEnabled !== prev.kdeBlurEnabled
    ) {
      await syncKdeBlur(delta.kdeBlurEnabled);
    }
  },

  reset: async () => {
    const prev = get().vars;
    const next = { vars: DEFAULT_THEME, presetId: "dark-glass" };
    set(next);
    applyTheme(DEFAULT_THEME);
    await persist(next);
    if (prev.kdeBlurEnabled) await syncKdeBlur(false);
  },
}));
