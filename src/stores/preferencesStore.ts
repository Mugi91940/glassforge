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

// Value shipped to the backend as ANTHROPIC_SMALL_FAST_MODEL. "auto"
// means "don't set the env var" — claude-code falls back to its own
// internal default for background tasks. Every other value is passed
// verbatim as the env var content (claude accepts short aliases).
export type SmallFastModel = "auto" | "haiku" | "sonnet" | "opus";

// Which model families the user has unlocked for 1M context.
// - "none": no 1M, default 200k window everywhere
// - "opus": Opus 1M only (Max/Team plan default)
// - "opus-sonnet": Opus AND Sonnet 1M (Sonnet 1M bills extra usage)
// Haiku is intentionally absent — Anthropic doesn't ship a 1M variant
// for Haiku, so it always stays on the 200k window regardless.
export type LongContextScope = "none" | "opus" | "opus-sonnet";

type Persisted = {
  permissionMode: PermissionMode;
  skipDeleteWarning: boolean;
  smallFastModel: SmallFastModel;
  longContextScope: LongContextScope;
};

type PreferencesState = {
  permissionMode: PermissionMode;
  skipDeleteWarning: boolean;
  smallFastModel: SmallFastModel;
  longContextScope: LongContextScope;
  loaded: boolean;

  load: () => Promise<void>;
  setPermissionMode: (mode: PermissionMode) => Promise<void>;
  setSkipDeleteWarning: (skip: boolean) => Promise<void>;
  setSmallFastModel: (m: SmallFastModel) => Promise<void>;
  setLongContextScope: (scope: LongContextScope) => Promise<void>;
};

const DEFAULTS: Persisted = {
  permissionMode: "acceptEdits",
  skipDeleteWarning: false,
  smallFastModel: "haiku",
  longContextScope: "none",
};

function isValidMode(v: unknown): v is PermissionMode {
  return (
    v === "acceptEdits" ||
    v === "bypassPermissions" ||
    v === "plan" ||
    v === "manual"
  );
}

function isValidSmallFastModel(v: unknown): v is SmallFastModel {
  return v === "auto" || v === "haiku" || v === "sonnet" || v === "opus";
}

function isValidLongContextScope(v: unknown): v is LongContextScope {
  return v === "none" || v === "opus" || v === "opus-sonnet";
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

function snapshot(state: PreferencesState): Persisted {
  return {
    permissionMode: state.permissionMode,
    skipDeleteWarning: state.skipDeleteWarning,
    smallFastModel: state.smallFastModel,
    longContextScope: state.longContextScope,
  };
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  permissionMode: DEFAULTS.permissionMode,
  skipDeleteWarning: DEFAULTS.skipDeleteWarning,
  smallFastModel: DEFAULTS.smallFastModel,
  longContextScope: DEFAULTS.longContextScope,
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
      const sfm =
        raw && isValidSmallFastModel(raw.smallFastModel)
          ? raw.smallFastModel
          : DEFAULTS.smallFastModel;
      const longCtx =
        raw && isValidLongContextScope(raw.longContextScope)
          ? raw.longContextScope
          : DEFAULTS.longContextScope;
      set({
        permissionMode: mode,
        skipDeleteWarning: skip,
        smallFastModel: sfm,
        longContextScope: longCtx,
        loaded: true,
      });
    } catch (e) {
      log.warn("preferences load failed", e);
      set({ loaded: true });
    }
  },

  setPermissionMode: async (mode) => {
    set({ permissionMode: mode });
    await persist(snapshot(get()));
  },

  setSkipDeleteWarning: async (skip) => {
    set({ skipDeleteWarning: skip });
    await persist(snapshot(get()));
  },

  setSmallFastModel: async (m) => {
    set({ smallFastModel: m });
    await persist(snapshot(get()));
  },

  setLongContextScope: async (scope) => {
    set({ longContextScope: scope });
    await persist(snapshot(get()));
  },
}));
