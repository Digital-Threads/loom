import { describe, it, expect } from "vitest";
import { summarizeCosts, type CostRowLike } from "./ui";

const row = (source: string, metric: string, value: number, exact = 1): CostRowLike => ({ source, metric, value, exact });

describe("summarizeCosts — $ saved", () => {
  it("adds a $ saved figure alongside saved tokens", () => {
    const s = summarizeCosts([
      row("token-pilot", "used", 500_000),
      row("token-pilot", "saved", 1_000_000),
    ]);
    expect(s.tokens).not.toBeNull();
    // 1M saved tokens valued at the default (Opus) input price $15/Mtok = $15.00.
    expect(s.tokens?.savedUsd).toBe("$15.00");
    // existing fields untouched
    expect(s.tokens?.saved).toBe("1M");
    expect(s.tokens?.savedPct).toBe(67);
  });

  it("leaves $ saved null when nothing was saved", () => {
    const s = summarizeCosts([row("token-pilot", "used", 500_000), row("token-pilot", "saved", 0)]);
    expect(s.tokens?.savedUsd).toBeNull();
  });

  it("keeps real spend and emptiness behaviour intact", () => {
    expect(summarizeCosts([]).empty).toBe(true);
    const s = summarizeCosts([row("aimux", "spent", 0.42)]);
    expect(s.spend).toBe("$0.42");
    expect(s.tokens).toBeNull();
  });
});
