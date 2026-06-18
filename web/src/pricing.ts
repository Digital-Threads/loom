// ─── Claude model pricing ────────────────────────────────────────────────────
// Public Claude API list prices (USD per 1M tokens), input + output. Single
// source of truth for turning token-pilot's "saved tokens" into a "$ saved"
// figure. This table does NOT replace real spend — the provider's
// total_cost_usd (aimux/spent) stays the source of truth for actual cost; these
// prices are only for the savings-in-$ estimate and a sanity cross-check.

export interface ModelPrice {
  id: string;
  label: string;
  inputPerMTok: number; // USD per 1M input tokens
  outputPerMTok: number; // USD per 1M output tokens
}

// Public list prices. Keep this list small and explicit; update here when the
// public price list changes.
export const MODEL_PRICES: ModelPrice[] = [
  { id: "opus", label: "Claude Opus", inputPerMTok: 15, outputPerMTok: 75 },
  { id: "sonnet", label: "Claude Sonnet", inputPerMTok: 3, outputPerMTok: 15 },
  { id: "haiku", label: "Claude Haiku", inputPerMTok: 1, outputPerMTok: 5 },
];

// Default model used to value token-pilot savings. token-pilot's saved tokens
// carry no model attribution, so we price them against one model and mark the
// result as approximate ("≈") in the UI.
export const DEFAULT_PRICING_MODEL = "opus";

// Resolved default price. Falls back to the first table entry if the default
// id is ever renamed/removed — so priceFor() can never return undefined and
// savedTokensToUsd() can't throw on a mis-edited table.
const DEFAULT_PRICE: ModelPrice =
  MODEL_PRICES.find((m) => m.id === DEFAULT_PRICING_MODEL) ?? MODEL_PRICES[0];

function priceFor(modelId?: string): ModelPrice {
  return MODEL_PRICES.find((m) => m.id === modelId) ?? DEFAULT_PRICE;
}

// Value saved tokens in USD using the model's INPUT price — token-pilot saves
// mostly input tokens (it avoids re-reading code into the prompt). Non-positive
// input → 0. Unknown model falls back to the default.
export function savedTokensToUsd(savedTokens: number, modelId?: string): number {
  if (!isFinite(savedTokens) || savedTokens <= 0) return 0;
  return (savedTokens * priceFor(modelId).inputPerMTok) / 1_000_000;
}
