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

// Whisper model size. "distil-large-v3" and "large-v3-turbo" are the best
// quality/speed compromises on modern hardware; tiny-medium are the classic
// OpenAI sizes.
export type VoiceModel =
  | "tiny"
  | "base"
  | "small"
  | "medium"
  | "large-v3"
  | "large-v3-turbo"
  | "distil-large-v3";

type Persisted = {
  permissionMode: PermissionMode;
  skipDeleteWarning: boolean;
  smallFastModel: SmallFastModel;
  longContextScope: LongContextScope;
  voiceModel: VoiceModel;
  voiceLang: "fr" | "en";
  voiceAutoSpeak: boolean;
  voiceHudDuration: number;
  voiceVolume: number;
};

type PreferencesState = {
  permissionMode: PermissionMode;
  skipDeleteWarning: boolean;
  smallFastModel: SmallFastModel;
  longContextScope: LongContextScope;
  voiceModel: VoiceModel;
  voiceLang: "fr" | "en";
  voiceAutoSpeak: boolean;
  voiceHudDuration: number;
  voiceVolume: number;
  loaded: boolean;

  load: () => Promise<void>;
  setPermissionMode: (mode: PermissionMode) => Promise<void>;
  setSkipDeleteWarning: (skip: boolean) => Promise<void>;
  setSmallFastModel: (m: SmallFastModel) => Promise<void>;
  setLongContextScope: (scope: LongContextScope) => Promise<void>;
  setVoiceModel: (m: VoiceModel) => Promise<void>;
  setVoiceLang: (l: "fr" | "en") => Promise<void>;
  setVoiceAutoSpeak: (v: boolean) => Promise<void>;
  setVoiceHudDuration: (s: number) => Promise<void>;
  setVoiceVolume: (v: number) => Promise<void>;
};

const DEFAULTS: Persisted = {
  permissionMode: "acceptEdits",
  skipDeleteWarning: false,
  smallFastModel: "haiku",
  longContextScope: "none",
  voiceModel: "distil-large-v3",
  voiceLang: "fr",
  voiceAutoSpeak: true,
  voiceHudDuration: 4,
  voiceVolume: 1,
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

const VOICE_MODELS: readonly VoiceModel[] = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3",
  "large-v3-turbo",
  "distil-large-v3",
];

function isValidVoiceModel(v: unknown): v is VoiceModel {
  return typeof v === "string" && (VOICE_MODELS as readonly string[]).includes(v);
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
    voiceModel: state.voiceModel,
    voiceLang: state.voiceLang,
    voiceAutoSpeak: state.voiceAutoSpeak,
    voiceHudDuration: state.voiceHudDuration,
    voiceVolume: state.voiceVolume,
  };
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  permissionMode: DEFAULTS.permissionMode,
  skipDeleteWarning: DEFAULTS.skipDeleteWarning,
  smallFastModel: DEFAULTS.smallFastModel,
  longContextScope: DEFAULTS.longContextScope,
  voiceModel: DEFAULTS.voiceModel,
  voiceLang: DEFAULTS.voiceLang,
  voiceAutoSpeak: DEFAULTS.voiceAutoSpeak,
  voiceHudDuration: DEFAULTS.voiceHudDuration,
  voiceVolume: DEFAULTS.voiceVolume,
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
      // One-time migration: tiny is too unreliable for French (it silently
      // emits English even with language="fr"). Anyone still on tiny —
      // either from the old default or a manual pick — gets bumped to
      // distil-large-v3, the current recommended balance of speed and
      // quality. We persist the new value so this only runs once.
      const rawModel = raw && isValidVoiceModel(raw.voiceModel)
        ? raw.voiceModel
        : DEFAULTS.voiceModel;
      const voiceModel: VoiceModel =
        rawModel === "tiny" ? "distil-large-v3" : rawModel;
      const voiceLang = raw && (raw.voiceLang === "fr" || raw.voiceLang === "en")
        ? raw.voiceLang
        : DEFAULTS.voiceLang;
      const voiceAutoSpeak = raw && typeof raw.voiceAutoSpeak === "boolean"
        ? raw.voiceAutoSpeak
        : DEFAULTS.voiceAutoSpeak;
      const voiceHudDuration = raw && typeof raw.voiceHudDuration === "number"
        ? raw.voiceHudDuration
        : DEFAULTS.voiceHudDuration;
      const voiceVolume = raw && typeof raw.voiceVolume === "number"
        ? Math.max(0, Math.min(1, raw.voiceVolume))
        : DEFAULTS.voiceVolume;
      set({
        permissionMode: mode,
        skipDeleteWarning: skip,
        smallFastModel: sfm,
        longContextScope: longCtx,
        voiceModel,
        voiceLang,
        voiceAutoSpeak,
        voiceHudDuration,
        voiceVolume,
        loaded: true,
      });
      // Persist the migrated voiceModel if it changed, so next boot skips
      // the migration branch.
      if (rawModel !== voiceModel) {
        await persist(snapshot(get()));
      }
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

  setVoiceModel: async (voiceModel) => {
    set({ voiceModel });
    await persist(snapshot(get()));
  },
  setVoiceLang: async (voiceLang) => {
    set({ voiceLang });
    await persist(snapshot(get()));
  },
  setVoiceAutoSpeak: async (voiceAutoSpeak) => {
    set({ voiceAutoSpeak });
    await persist(snapshot(get()));
  },
  setVoiceHudDuration: async (voiceHudDuration) => {
    set({ voiceHudDuration });
    await persist(snapshot(get()));
  },
  setVoiceVolume: async (voiceVolume) => {
    const clamped = Math.max(0, Math.min(1, voiceVolume));
    set({ voiceVolume: clamped });
    await persist(snapshot(get()));
  },
}));
