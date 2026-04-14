// Thin logging wrapper. Routes through tauri-plugin-log in release and
// falls back to the browser console in dev (Vite HMR). Keeps the app
// free of naked `console.log` calls as required by CLAUDE.md.

import * as log from "@tauri-apps/plugin-log";

const DEV = import.meta.env.DEV;

export async function debug(...args: unknown[]): Promise<void> {
  const msg = args.map(format).join(" ");
  if (DEV) console.debug("[glassforge]", msg);
  await log.debug(msg).catch(() => {});
}

export async function info(...args: unknown[]): Promise<void> {
  const msg = args.map(format).join(" ");
  if (DEV) console.info("[glassforge]", msg);
  await log.info(msg).catch(() => {});
}

export async function warn(...args: unknown[]): Promise<void> {
  const msg = args.map(format).join(" ");
  if (DEV) console.warn("[glassforge]", msg);
  await log.warn(msg).catch(() => {});
}

export async function error(...args: unknown[]): Promise<void> {
  const msg = args.map(format).join(" ");
  if (DEV) console.error("[glassforge]", msg);
  await log.error(msg).catch(() => {});
}

function format(x: unknown): string {
  if (x instanceof Error) return `${x.name}: ${x.message}`;
  if (typeof x === "object") {
    try {
      return JSON.stringify(x);
    } catch {
      return String(x);
    }
  }
  return String(x);
}
