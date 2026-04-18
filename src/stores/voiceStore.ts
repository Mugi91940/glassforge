// src/stores/voiceStore.ts
import { create } from "zustand";

export type VoicePhase = "idle" | "listening" | "processing" | "speaking";

type VoiceState = {
  phase: VoicePhase;
  transcript: string;
  response: string;
  setPhase: (phase: VoicePhase) => void;
  setTranscript: (text: string) => void;
  setResponse: (text: string) => void;
  reset: () => void;
};

export const useVoiceStore = create<VoiceState>((set) => ({
  phase: "idle",
  transcript: "",
  response: "",
  setPhase: (phase) => set({ phase }),
  setTranscript: (transcript) => set({ transcript }),
  setResponse: (response) => set({ response }),
  reset: () => set({ phase: "idle", transcript: "", response: "" }),
}));
