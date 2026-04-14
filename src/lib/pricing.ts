// Rough USD pricing per 1M tokens. These are declarative best-effort
// estimates, not live figures — GlassForge never queries a pricing API.
// Update them as model lineups evolve.

export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow: number;
};

export const PRICING: Record<string, ModelPricing> = {
  opus: { inputPerMTok: 15, outputPerMTok: 75, contextWindow: 200_000 },
  "opus-4": { inputPerMTok: 15, outputPerMTok: 75, contextWindow: 200_000 },
  "opus-4-6": { inputPerMTok: 15, outputPerMTok: 75, contextWindow: 1_000_000 },
  sonnet: { inputPerMTok: 3, outputPerMTok: 15, contextWindow: 200_000 },
  "sonnet-4": { inputPerMTok: 3, outputPerMTok: 15, contextWindow: 200_000 },
  "sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, contextWindow: 1_000_000 },
  haiku: { inputPerMTok: 0.8, outputPerMTok: 4, contextWindow: 200_000 },
  "haiku-4-5": { inputPerMTok: 0.8, outputPerMTok: 4, contextWindow: 200_000 },
};

export const DEFAULT_PRICING: ModelPricing = {
  inputPerMTok: 3,
  outputPerMTok: 15,
  contextWindow: 200_000,
};

export function resolvePricing(model: string | null | undefined): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  const key = model.toLowerCase();
  if (PRICING[key]) return PRICING[key];
  for (const [name, price] of Object.entries(PRICING)) {
    if (key.includes(name)) return price;
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

export function formatTokens(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
