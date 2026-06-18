import { describe, it, expect } from "vitest";
import { MODEL_PRICES, DEFAULT_PRICING_MODEL, savedTokensToUsd } from "./pricing";

describe("pricing", () => {
  it("prices saved tokens with a known model's input rate", () => {
    // 1M tokens at Sonnet's $3/Mtok input = $3.
    expect(savedTokensToUsd(1_000_000, "sonnet")).toBeCloseTo(3, 6);
    // 2M tokens at Opus's $15/Mtok input = $30.
    expect(savedTokensToUsd(2_000_000, "opus")).toBeCloseTo(30, 6);
  });

  it("falls back to the default model for an unknown id", () => {
    const def = MODEL_PRICES.find((m) => m.id === DEFAULT_PRICING_MODEL)!;
    expect(savedTokensToUsd(1_000_000, "nope")).toBeCloseTo(def.inputPerMTok, 6);
    expect(savedTokensToUsd(1_000_000)).toBeCloseTo(def.inputPerMTok, 6);
  });

  it("returns 0 for non-positive or invalid token counts", () => {
    expect(savedTokensToUsd(0)).toBe(0);
    expect(savedTokensToUsd(-100)).toBe(0);
    expect(savedTokensToUsd(NaN)).toBe(0);
  });

  it("has only positive prices in the table", () => {
    expect(MODEL_PRICES.length).toBeGreaterThan(0);
    for (const m of MODEL_PRICES) {
      expect(m.inputPerMTok).toBeGreaterThan(0);
      expect(m.outputPerMTok).toBeGreaterThan(0);
    }
  });
});
