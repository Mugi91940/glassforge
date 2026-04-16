// Rough USD pricing per 1M tokens. These are declarative best-effort
// estimates, not live figures — GlassForge never queries a pricing API.
// Update them as model lineups evolve.

export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow: number;
};

// Claude-code exposes the 1M-context tier for Opus and Sonnet 4.7 as an
// entry in its `/model` menu (no env var or beta flag needed on Max/Team
// plans). When the user picks one, claude reports a model string that
// contains `1m` in the next assistant event — we detect that via the
// `-1m` suffixed entries below and switch the ring to the 1M window.
// All other variants stay on the standard 200k.
export const PRICING: Record<string, ModelPricing> = {
  opus: { inputPerMTok: 15, outputPerMTok: 75, contextWindow: 200_000 },
  "opus-4": { inputPerMTok: 15, outputPerMTok: 75, contextWindow: 200_000 },
  "opus-4-6": { inputPerMTok: 15, outputPerMTok: 75, contextWindow: 200_000 },
  "opus-4-7": { inputPerMTok: 15, outputPerMTok: 75, contextWindow: 200_000 },
  "opus-1m": { inputPerMTok: 15, outputPerMTok: 75, contextWindow: 1_000_000 },
  "opus-4-6-1m": {
    inputPerMTok: 15,
    outputPerMTok: 75,
    contextWindow: 1_000_000,
  },
  "opus-4-7-1m": {
    inputPerMTok: 15,
    outputPerMTok: 75,
    contextWindow: 1_000_000,
  },
  sonnet: { inputPerMTok: 3, outputPerMTok: 15, contextWindow: 200_000 },
  "sonnet-4": { inputPerMTok: 3, outputPerMTok: 15, contextWindow: 200_000 },
  "sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, contextWindow: 200_000 },
  "sonnet-1m": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    contextWindow: 1_000_000,
  },
  "sonnet-4-6-1m": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    contextWindow: 1_000_000,
  },
  haiku: { inputPerMTok: 0.8, outputPerMTok: 4, contextWindow: 200_000 },
  "haiku-4-5": { inputPerMTok: 0.8, outputPerMTok: 4, contextWindow: 200_000 },
};

export const DEFAULT_PRICING: ModelPricing = {
  inputPerMTok: 15,
  outputPerMTok: 75,
  contextWindow: 200_000,
};

// Iterating PRICING in insertion order would match "opus" before
// "opus-4-7" for a string like "claude-opus-4-7-20260415" and return the
// wrong (200k) context window. Sort by key length descending so the
// most specific alias wins.
const PRICING_KEYS_BY_SPECIFICITY = Object.keys(PRICING).sort(
  (a, b) => b.length - a.length,
);

// Detects model strings that carry the 1M-context marker. Claude-code
// uses the `opus[1m]` / `sonnet[1m]` bracket notation as the canonical
// alias and echoes it back in its event stream (e.g.
// `"modelUsage":{"claude-opus-4-7[1m]":{...}}`). We also accept a few
// hyphen-variant spellings just in case future builds differ.
function detect1mVariant(key: string): ModelPricing | null {
  if (!/\[1m\]|\b1m\b|-1m-|-1m$/.test(key)) return null;
  if (key.includes("opus")) return PRICING["opus-1m"];
  if (key.includes("sonnet")) return PRICING["sonnet-1m"];
  return null;
}

export function resolvePricing(model: string | null | undefined): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  const key = model.toLowerCase();
  if (PRICING[key]) return PRICING[key];
  const longCtx = detect1mVariant(key);
  if (longCtx) return longCtx;
  for (const name of PRICING_KEYS_BY_SPECIFICITY) {
    if (key.includes(name)) return PRICING[name];
  }
  return DEFAULT_PRICING;
}

// Rule-of-thumb token estimate: ~4 bytes per token for English/code mix.
export function estimateTokens(bytes: number): number {
  return Math.max(0, Math.round(bytes / 4));
}

export function estimateCostUsd(
  model: string | null | undefined,
  inTokens: number,
  outTokens: number,
): number {
  const p = resolvePricing(model);
  return (inTokens / 1_000_000) * p.inputPerMTok +
    (outTokens / 1_000_000) * p.outputPerMTok;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// Pull the model family out of a raw claude string so consumers can
// key behavior off of it (e.g. the 1M-context opt-in is per-family
// since Haiku doesn't ship a 1M variant).
export type ModelFamily = "opus" | "sonnet" | "haiku";

export function modelFamily(
  model: string | null | undefined,
): ModelFamily | null {
  if (!model) return null;
  const key = model.toLowerCase();
  if (key.includes("opus")) return "opus";
  if (key.includes("sonnet")) return "sonnet";
  if (key.includes("haiku")) return "haiku";
  return null;
}

// Turn a raw claude model string (e.g. "claude-opus-4-7[1m]") into a
// compact label suitable for UI chips — "Opus 4.7 1M". Falls back to
// the input string untouched if it doesn't match a known shape.
export function prettyModelName(model: string): string {
  const key = model.toLowerCase();
  let family: string | null = null;
  if (key.includes("opus")) family = "Opus";
  else if (key.includes("sonnet")) family = "Sonnet";
  else if (key.includes("haiku")) family = "Haiku";
  if (!family) return model;

  const versionMatch = key.match(/(\d)-(\d)/);
  const version = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : null;

  const is1m = /\[1m\]|\b1m\b|-1m-|-1m$/.test(key);

  const parts: string[] = [family];
  if (version) parts.push(version);
  if (is1m) parts.push("1M");
  return parts.join(" ");
}

export function formatTokens(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
