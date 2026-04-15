import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ImagePlus, Send, Square, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import * as log from "@/lib/log";
import {
  killSession,
  readImageAsDataUrl,
  saveClipboardImage,
  sendMessage,
} from "@/lib/tauri-commands";
import type { ChatEntry } from "@/lib/types";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore } from "@/stores/sessionStore";

import styles from "./ComposeInput.module.css";

type Attachment = {
  id: string;
  path: string;
  name: string;
  dataUrl: string | null;
  loading: boolean;
  error?: string;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i;

function extensionFromMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower === "image/jpeg" || lower === "image/jpg") return "jpg";
  if (lower === "image/png") return "png";
  if (lower === "image/gif") return "gif";
  if (lower === "image/webp") return "webp";
  if (lower === "image/bmp") return "bmp";
  if (lower === "image/svg+xml") return "svg";
  if (lower === "image/avif") return "avif";
  if (lower === "image/heic") return "heic";
  return "png";
}

function makeAttachmentId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

type Props = {
  sessionId: string;
  disabled?: boolean;
};

type SlashCommand = {
  name: string;
  description: string;
  completion: string; // what to write into the input when picked
};

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/clear",
    description: "Wipe the local transcript (claude session untouched)",
    completion: "/clear",
  },
  {
    name: "/model",
    description: "Switch model: opus | sonnet | haiku | default",
    completion: "/model ",
  },
  {
    name: "/compact",
    description: "Ask claude to summarize the conversation",
    completion: "/compact",
  },
  {
    name: "/help",
    description: "Show the list of slash commands",
    completion: "/help",
  },
];

const SLASH_HELP = SLASH_COMMANDS.map(
  (c) => `${c.name} — ${c.description}`,
).join("\n");

export function ComposeInput({ sessionId, disabled }: Props) {
  const model = useSessionStore(
    (s) => s.sessions[sessionId]?.model ?? null,
  );
  const isRunning = useSessionStore(
    (s) => s.sessions[sessionId]?.status === "running",
  );
  const permissionMode = usePreferencesStore((s) => s.permissionMode);
  const smallFastModelPref = usePreferencesStore((s) => s.smallFastModel);
  const updateSession = useSessionStore((s) => s.updateSession);
  const seedEntries = useSessionStore((s) => s.seedEntries);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const addAttachmentFromPath = useCallback(async (path: string) => {
    if (!IMAGE_EXT.test(path)) {
      log.warn("attachment ignored (not an image):", path);
      return;
    }
    const id = makeAttachmentId();
    setAttachments((prev) => [
      ...prev,
      {
        id,
        path,
        name: basename(path),
        dataUrl: null,
        loading: true,
      },
    ]);
    try {
      const dataUrl = await readImageAsDataUrl(path);
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, dataUrl, loading: false } : a,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("readImageAsDataUrl failed", msg);
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, loading: false, error: msg } : a,
        ),
      );
    }
  }, []);

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function onPickFiles() {
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "gif",
              "webp",
              "bmp",
              "svg",
              "avif",
              "heic",
            ],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) await addAttachmentFromPath(p);
    } catch (e) {
      log.warn("open dialog failed", e);
    }
  }

  // Native drag-drop via Tauri's window event — standard HTML5 `drop`
  // doesn't surface real filesystem paths inside the webview, so we
  // listen at the window level and get them straight from the OS.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const win = getCurrentWindow();
        const dispose = await win.onDragDropEvent((event) => {
          if (cancelled) return;
          const payload = event.payload as {
            type: string;
            paths?: string[];
          };
          if (payload.type === "enter" || payload.type === "over") {
            setDragOver(true);
          } else if (payload.type === "leave") {
            setDragOver(false);
          } else if (payload.type === "drop") {
            setDragOver(false);
            const paths = payload.paths ?? [];
            for (const p of paths) {
              void addAttachmentFromPath(p);
            }
          }
        });
        if (cancelled) {
          dispose();
        } else {
          unlisten = dispose;
        }
      } catch (e) {
        log.warn("onDragDropEvent attach failed", e);
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [addAttachmentFromPath]);

  // Clipboard paste: when the user pastes into the textarea, inspect
  // the clipboard items for image blobs. If any, intercept, write the
  // bytes to a temp file via the Rust side, and register as an
  // attachment. Plain-text pastes fall through untouched.
  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const ext = extensionFromMime(file.type);
        const path = await saveClipboardImage(buffer, ext);
        await addAttachmentFromPath(path);
      } catch (err) {
        log.warn("paste image failed", err);
      }
    }
  }

  // Slash autocomplete is active when the line the cursor is on starts
  // with '/' and contains no whitespace after it yet. Keeps multiline
  // messages free of interference.
  const slashSuggestions = useMemo(() => {
    if (!text.startsWith("/")) return [] as SlashCommand[];
    const firstWord = text.split(/\s/)[0];
    if (!firstWord.startsWith("/")) return [];
    if (text.includes(" ") || text.includes("\n")) return [];
    const prefix = firstWord.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));
  }, [text]);

  useEffect(() => {
    if (menuIndex >= slashSuggestions.length) setMenuIndex(0);
  }, [slashSuggestions.length, menuIndex]);

  function applySuggestion(cmd: SlashCommand) {
    setText(cmd.completion);
    textareaRef.current?.focus();
  }

  function pushSystem(text: string) {
    const prev = useSessionStore.getState().entries[sessionId] ?? [];
    const next: ChatEntry[] = [
      ...prev,
      { kind: "system", ts: Date.now(), text },
    ];
    seedEntries(sessionId, next);
  }

  /** Returns true if the input was handled locally and sendMessage should
   *  be skipped. */
  function handleSlashCommand(raw: string): boolean {
    if (!raw.startsWith("/")) return false;
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();

    switch (cmd) {
      case "clear": {
        seedEntries(sessionId, []);
        return true;
      }
      case "model": {
        const normalized = arg.toLowerCase();
        const valid = new Set(["opus", "sonnet", "haiku", "default", ""]);
        if (!valid.has(normalized)) {
          pushSystem(
            `/model: unknown '${arg}'. Accepted: opus, sonnet, haiku, default.`,
          );
          return true;
        }
        const nextModel =
          normalized === "" || normalized === "default" ? null : normalized;
        updateSession(sessionId, { model: nextModel });
        pushSystem(
          `Model set to ${nextModel ?? "default"} for this session.`,
        );
        return true;
      }
      case "compact": {
        // Forward a summarize prompt — claude will reply with a
        // compact digest which the user can then refer to.
        void (async () => {
          setBusy(true);
          try {
            await sendMessage(
              sessionId,
              "Summarize our conversation so far as concisely as possible, preserving all decisions, file paths, and pending TODOs. Return just the summary.",
              model,
              permissionMode,
            );
          } catch (e) {
            log.error("compact send failed", e);
          } finally {
            setBusy(false);
            textareaRef.current?.focus();
          }
        })();
        return true;
      }
      case "help": {
        pushSystem(SLASH_HELP);
        return true;
      }
      default:
        return false;
    }
  }

  async function onSubmit() {
    const trimmed = text.trim();
    const readyAttachments = attachments.filter((a) => !a.loading);
    if (busy || isRunning) return;
    if (!trimmed && readyAttachments.length === 0) return;

    if (trimmed && handleSlashCommand(trimmed)) {
      setText("");
      textareaRef.current?.focus();
      return;
    }

    // Claude-code picks up `@/path/to/file` tokens in the prompt and
    // inlines the referenced image — same convention as the interactive
    // CLI. Prepend one per attachment on its own line so claude sees
    // them before the user's wording.
    const attachmentPrefix = readyAttachments
      .map((a) => `@${a.path}`)
      .join("\n");
    const message = attachmentPrefix
      ? trimmed
        ? `${attachmentPrefix}\n${trimmed}`
        : attachmentPrefix
      : trimmed;

    // Route /compact through Haiku: the only thing the call does is
    // summarize the prior turns, and Haiku is plenty for that — using
    // Opus or Sonnet here would burn premium usage on a one-shot
    // summary. The override is per-call, the session's selected model
    // (and the user's next regular messages) stay untouched.
    const isCompact = /^\/compact(\s|$)/i.test(message);
    const effectiveModel = isCompact ? "haiku" : model;
    // Translate the user's preference into what the backend expects:
    // "auto" means leave ANTHROPIC_SMALL_FAST_MODEL unset (claude picks
    // its own default); any other value is passed verbatim.
    const smallFastForCall =
      smallFastModelPref === "auto" ? null : smallFastModelPref;

    setBusy(true);
    try {
      await sendMessage(
        sessionId,
        message,
        effectiveModel,
        permissionMode,
        smallFastForCall,
      );
      setText("");
      setAttachments([]);
    } catch (e) {
      log.error("send_message failed", e);
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  async function onCancel() {
    try {
      await killSession(sessionId);
    } catch (e) {
      log.error("kill_session failed", e);
    }
    // Force the UI back to idle immediately so the user can send again.
    // The backend reader thread will also emit a status event once the
    // child exits, but inside Flatpak the kill signal may not propagate
    // to the actual claude process on the host — in that case the
    // backend status catches up when claude finishes on its own.
    useSessionStore.getState().updateStatus(sessionId, "idle");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const menuOpen = slashSuggestions.length > 0;
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) =>
          Math.min(slashSuggestions.length - 1, i + 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const pick = slashSuggestions[menuIndex];
        if (pick) applySuggestion(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setText("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (menuOpen && slashSuggestions.length > 0) {
        // When the menu is open, Enter picks the highlighted command
        // instead of submitting — unless the user already typed it out
        // completely and the menu only shows a single exact match.
        const pick = slashSuggestions[menuIndex];
        const exactMatch =
          slashSuggestions.length === 1 && pick?.name === text.trim();
        if (!exactMatch && pick) {
          e.preventDefault();
          applySuggestion(pick);
          return;
        }
      }
      e.preventDefault();
      void onSubmit();
    }
  }

  const hasReady = attachments.some((a) => !a.loading);
  const canSend = !busy && (text.trim().length > 0 || hasReady);

  return (
    <div className={styles.root}>
      {slashSuggestions.length > 0 ? (
        <ul className={styles.slashMenu} role="listbox">
          {slashSuggestions.map((cmd, i) => (
            <li
              key={cmd.name}
              className={`${styles.slashItem} ${
                i === menuIndex ? styles.slashItemActive : ""
              }`}
              onMouseEnter={() => setMenuIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(cmd);
              }}
              role="option"
              aria-selected={i === menuIndex}
            >
              <span className={styles.slashName}>{cmd.name}</span>
              <span className={styles.slashDescription}>
                {cmd.description}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {attachments.length > 0 ? (
        <div className={styles.attachments}>
          {attachments.map((a) => (
            <div key={a.id} className={styles.attachment}>
              {a.dataUrl ? (
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className={styles.attachmentImage}
                />
              ) : (
                <div className={styles.attachmentPlaceholder}>
                  {a.error ? "error" : a.loading ? "loading…" : ""}
                </div>
              )}
              <span className={styles.attachmentName} title={a.path}>
                {a.name}
              </span>
              <button
                type="button"
                className={styles.attachmentRemove}
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.inputRow}>
        <button
          type="button"
          className={styles.attachButton}
          onClick={() => void onPickFiles()}
          disabled={disabled || busy || isRunning}
          aria-label="Attach image"
          title="Attach image (or drag-drop / paste)"
        >
          <ImagePlus size={14} />
        </button>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder={
            disabled
              ? "Session is not ready."
              : isRunning
                ? "Claude is replying — wait or cancel to send again."
                : "Message Claude — Enter to send, Shift+Enter for newline"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => void onPaste(e)}
          disabled={disabled || busy || isRunning}
          rows={2}
          spellCheck={false}
        />
        {isRunning ? (
          <button
            type="button"
            className={`${styles.sendButton} ${styles.cancelButton}`}
            onClick={() => void onCancel()}
            aria-label="Cancel current reply"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            type="button"
            className={styles.sendButton}
            onClick={() => void onSubmit()}
            disabled={disabled || !canSend}
            aria-label="Send message"
          >
            <Send size={14} />
          </button>
        )}
      </div>

      {dragOver ? (
        <div className={styles.dropOverlay}>
          Drop image to attach
        </div>
      ) : null}
    </div>
  );
}
