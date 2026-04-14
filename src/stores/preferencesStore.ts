import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";

import * as log from "@/lib/log";
import type { PermissionMode } from "@/lib/tauri-commands";

const STORE_FILE = "settings.json";
const KEY = "preferences";

let storeInstance: LazyStore | null = null;
function getStore(): LazyStore {
  if (!storeInstance) storeInstance = new LazyStore(STORE_FILE);
  return storeInstance;
}

type Persisted = {
  permissionMode: PermissionMode;
  skipDeleteWarning: boolean;
};

type PreferencesState = {
  permissionMode: PermissionMode;
  skipDeleteWarning: boolean;
  loaded: boolean;

  load: () => Promise<void>;
  setPermissionMode: (mode: PermissionMode) => Promise<void>;
  setSkipDeleteWarning: (skip: boolean) => Promise<void>;
};

const DEFAULTS: Persisted = {
  permissionMode: "acceptEdits",
  skipDeleteWarning: false,
};

function isValidMode(v: unknown): v is PermissionMode {
  return (
    v === "acceptEdits" ||
    v === "bypassPermissions" ||
    v === "plan" ||
    v === "manual"
  );
}

async function persist(next: Persisted): Promise<void> {
  try {
    const s = getStore();
    await s.set(KEY, next);
    await s.save();
  } catch (e) {
    log.warn("preferences save failed", e);
  }
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  permissionMode: DEFAULTS.permissionMode,
  skipDeleteWarning: DEFAULTS.skipDeleteWarning,
  loaded: false,

  load: async () => {
    try {
      const s = getStore();
      const raw = (await s.get<Persisted>(KEY)) ?? null;
      const mode =
        raw && isValidMode(raw.permissionMode)
          ? raw.permissionMode
          : DEFAULTS.permissionMode;
      const skip =
        raw && typeof raw.skipDeleteWarning === "boolean"
          ? raw.skipDeleteWarning
          : DEFAULTS.skipDeleteWarning;
      set({ permissionMode: mode, skipDeleteWarning: skip, loaded: true });
    } catch (e) {
      log.warn("preferences load failed", e);
      set({ loaded: true });
    }
  },

  setPermissionMode: async (mode) => {
    set({ permissionMode: mode });
    await persist({
      permissionMode: mode,
      skipDeleteWarning: get().skipDeleteWarning,
    });
  },

  setSkipDeleteWarning: async (skip) => {
    set({ skipDeleteWarning: skip });
    await persist({
      permissionMode: get().permissionMode,
      skipDeleteWarning: skip,
    });
  },
}));
