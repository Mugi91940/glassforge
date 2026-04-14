export type SessionStatus = "starting" | "active" | "idle" | "done" | "error";

export type SessionInfo = {
  id: string;
  project_path: string;
  model: string | null;
  status: SessionStatus;
  created_at: number;
};

export type SessionEntryKind = "user" | "stdout" | "system";

export type SessionEntry = {
  kind: SessionEntryKind;
  ts: number;
  text: string;
};

export type StdoutChunkPayload = {
  data: string;
};

export type ExitPayload = {
  code: number | null;
  success: boolean;
};
