import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronDown, ChevronRight, Copy, GitBranch, Wrench } from "lucide-react";

import * as log from "@/lib/log";
import {
  formatCost,
  prettyModelName,
} from "@/lib/pricing";
import { computeSessionStats } from "@/lib/sessionStats";
import {
  readGitInfo,
  type GitInfo,
} from "@/lib/tauri-commands";
import type { ChatEntry, SessionInfo } from "@/lib/types";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore, type SessionUsage } from "@/stores/sessionStore";

import { ContextRing } from "@/components/stats/ContextRing";
import { Dropdown, type DropdownOption } from "@/components/ui/Dropdown";

import styles from "./ChatView.module.css";

const MODEL_OPTIONS: DropdownOption<string | null>[] = [
  { label: "Default", value: null },
  { label: "Opus 4.6", value: "opus" },
  // `opus[1m]` / `sonnet[1m]` are claude-code's own 1M-context aliases
  // (confirmed via `strings` on the CLI + live smoke test). Passing them
  // through `--model` makes claude itself run on the 1M window — no
  // guessing, no observation needed. Haiku has no 1M variant.
  { label: "Opus 4.6 (1M)", value: "opus[1m]" },
  { label: "Sonnet 4.6", value: "sonnet" },
  { label: "Sonnet 4.6 (1M)", value: "sonnet[1m]" },
  { label: "Haiku 4.5", value: "haiku" },
];

type Props = {
  session: SessionInfo;
  entries: ChatEntry[];
};

export function ChatView({ session, entries }: Props) {
  const updateSession = useSessionStore((s) => s.updateSession);
  const usage = useSessionStore(
    (s) => s.usage[session.id] ?? null,
  ) as SessionUsage | null;
  const longContextScope = usePreferencesStore((s) => s.longContextScope);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [git, setGit] = useState<GitInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    readGitInfo(session.project_path)
      .then((g) => {
        if (!cancelled) setGit(g);
      })
      .catch((e) => log.warn("read_git_info failed", e));
    return () => {
      cancelled = true;
    };
  }, [session.project_path]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  // When the session is on Default and claude has reported what model it
  // actually ran on, surface that in the dropdown label so the user sees
  // "Default (Opus 4.6 1M)" instead of a mystery "Default".
  const modelOptions = useMemo<DropdownOption<string | null>[]>(() => {
    if (session.model !== null || !usage?.detectedModel) return MODEL_OPTIONS;
    return MODEL_OPTIONS.map((opt) =>
      opt.value === null
        ? {
            ...opt,
            label: `Default (${prettyModelName(usage.detectedModel!)})`,
          }
        : opt,
    );
  }, [session.model, usage?.detectedModel]);

  const stats = useMemo(
    () => computeSessionStats(usage, session, longContextScope),
    [usage, session, longContextScope],
  );

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.projectLine}>
            {git ? (
              <>
                <span className={styles.repoName}>{git.repoName}</span>
                {git.branch ? (
                  <span className={styles.branch}>
                    <GitBranch size={11} />
                    {git.branch}
                  </span>
                ) : null}
                <span className={styles.projectPathDim} title={session.project_path}>
                  {session.project_path}
                </span>
              </>
            ) : (
              <div className={styles.projectPath} title={session.project_path}>
                {session.project_path}
              </div>
            )}
          </div>
          <div className={styles.meta}>
            <Dropdown
              size="sm"
              ariaLabel="Model"
              options={modelOptions}
              value={session.model ?? null}
              onChange={(v) => updateSession(session.id, { model: v })}
            />
            <span className={styles[session.status]}>{session.status}</span>
          </div>
        </div>
        <ContextRing
          used={stats.ctxUsed}
          total={stats.ctxTotal}
          size={54}
          modelName={usage?.detectedModel ?? session.model ?? null}
        />
      </div>

      <div ref={scrollRef} className={styles.log}>
        {entries.length === 0 ? (
          <div className={styles.empty}>
            <p>Session ready. Send your first message below.</p>
          </div>
        ) : (
          entries.map((entry, i) => (
            <Entry key={entryKey(entry, i)} entry={entry} />
          ))
        )}
        {session.status === "running" ? (
          <div className={`${styles.entry} ${styles.typing}`}>
            <div className={styles.typingDots}>
              <span />
              <span />
              <span />
            </div>
            <span className={styles.typingLabel}>Claude is thinking…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch((e) => log.warn("clipboard write failed", e));
  }, [text]);

  return (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={onClick}
      title="Copy"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

const mdComponents: Components = {
  pre({ children }) {
    const text = extractText(children);
    return (
      <div className={styles.codeBlockWrap}>
        <pre>{children}</pre>
        {text.trim() ? <CopyButton text={text} /> : null}
      </div>
    );
  },
};

function entryKey(entry: ChatEntry, i: number): string {
  if (entry.kind === "tool") return `tool-${entry.id}-${i}`;
  return `${entry.kind}-${entry.ts}-${i}`;
}

function Entry({ entry }: { entry: ChatEntry }) {
  if (entry.kind === "user") {
    return (
      <div className={`${styles.entry} ${styles.userEntry}`}>
        <div className={styles.markdown}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {entry.text}
          </ReactMarkdown>
        </div>
      </div>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <div className={`${styles.entry} ${styles.assistantEntry}`}>
        <div className={styles.markdown}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {entry.text}
          </ReactMarkdown>
        </div>
      </div>
    );
  }
  if (entry.kind === "tool") {
    return <ToolCall entry={entry} />;
  }
  if (entry.kind === "result") {
    return (
      <div className={`${styles.entry} ${styles.resultEntry}`}>
        {typeof entry.costUsd === "number"
          ? `cost ${formatCost(entry.costUsd)}`
          : "result"}
        {entry.durationMs
          ? ` · ${(entry.durationMs / 1000).toFixed(1)}s`
          : ""}
        {entry.numTurns ? ` · ${entry.numTurns} turns` : ""}
      </div>
    );
  }
  if (entry.kind === "error") {
    return (
      <div className={`${styles.entry} ${styles.errorEntry}`}>
        {entry.text}
      </div>
    );
  }
  return (
    <div className={`${styles.entry} ${styles.systemEntry}`}>
      <pre className={styles.entryText}>{entry.text}</pre>
    </div>
  );
}

function ToolCall({
  entry,
}: {
  entry: Extract<ChatEntry, { kind: "tool" }>;
}) {
  const [open, setOpen] = useState(false);
  const inputPreview = useMemo(() => {
    try {
      const s = JSON.stringify(entry.input);
      if (!s) return "";
      return s.length > 120 ? s.slice(0, 120) + "…" : s;
    } catch {
      return "";
    }
  }, [entry.input]);

  return (
    <div
      className={`${styles.entry} ${styles.toolEntry} ${
        entry.isError ? styles.toolError : ""
      }`}
    >
      <button
        type="button"
        className={styles.toolHeader}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} />
        <span className={styles.toolName}>{entry.name}</span>
        {!open && inputPreview ? (
          <span className={styles.toolPreview}>{inputPreview}</span>
        ) : null}
      </button>
      {open ? (
        <div className={styles.toolBody}>
          {entry.input !== undefined ? (
            <>
              <div className={styles.toolLabel}>input</div>
              <div className={styles.codeBlockWrap}>
                <pre className={styles.toolCode}>
                  {JSON.stringify(entry.input, null, 2)}
                </pre>
                <CopyButton text={JSON.stringify(entry.input, null, 2)} />
              </div>
            </>
          ) : null}
          {entry.result ? (
            <>
              <div className={styles.toolLabel}>result</div>
              <div className={styles.codeBlockWrap}>
                <pre className={styles.toolCode}>{entry.result}</pre>
                <CopyButton text={entry.result} />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

