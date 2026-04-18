// src/stores/voiceStore.ts
import { create } from "zustand";

export type VoicePhase =
  | "idle"
  | "listening"
  | "editing"
  | "processing"
  | "speaking";

export type ConversationEntry = {
  role: "user" | "assistant";
  text: string;
};

type VoiceState = {
  phase: VoicePhase;
  transcript: string;
  draft: string;
  response: string;
  conversation: ConversationEntry[];
  setPhase: (phase: VoicePhase) => void;
  setTranscript: (text: string) => void;
  setDraft: (text: string) => void;
  setResponse: (text: string) => void;
  setConversation: (entries: ConversationEntry[]) => void;
  reset: () => void;
};

export const useVoiceStore = create<VoiceState>((set) => ({
  phase: "idle",
  transcript: "",
  draft: "",
  response: "",
  conversation: [],
  setPhase: (phase) => set({ phase }),
  setTranscript: (transcript) => set({ transcript }),
  setDraft: (draft) => set({ draft }),
  setResponse: (response) => set({ response }),
  setConversation: (conversation) => set({ conversation }),
  reset: () =>
    set({ phase: "idle", transcript: "", draft: "", response: "" }),
}));
