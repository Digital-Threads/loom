import { describe, it, expect } from "vitest";
import { formatTokens, formatUsd, summarizeCosts, groupLiveStream } from "../../web/src/ui.js";

describe("formatTokens", () => {
  it("scales to k / M and trims", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(15000)).toBe("15k");
    expect(formatTokens(800000)).toBe("800k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(12_000_000)).toBe("12M");
  });
});

describe("formatUsd", () => {
  it("formats money, extra precision for sub-cent", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.42)).toBe("$0.42");
    expect(formatUsd(0.003)).toBe("$0.0030");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});

describe("summarizeCosts", () => {
  it("folds rows into spend + token breakdown", () => {
    const s = summarizeCosts([
      { source: "aimux", metric: "spent", value: 0.42, exact: 1 },
      { source: "token-pilot", metric: "used", value: 600000, exact: 1 },
      { source: "token-pilot", metric: "saved", value: 400000, exact: 1 },
    ]);
    expect(s.spend).toBe("$0.42");
    expect(s.spendEstimate).toBe(false);
    expect(s.tokens).toEqual({ used: "600k", saved: "400k", savedPct: 40 });
    expect(s.empty).toBe(false);
  });

  it("marks estimates and handles missing rows", () => {
    const s = summarizeCosts([
      { source: "token-pilot", metric: "used", value: 1000, exact: 0 },
    ]);
    expect(s.spend).toBeNull();
    expect(s.tokens).toEqual({ used: "1k", saved: "0", savedPct: 0 });
    expect(s.tokensEstimate).toBe(true);
  });

  it("keeps unknown rows in `other` and reports empty", () => {
    expect(summarizeCosts([]).empty).toBe(true);
    const s = summarizeCosts([{ source: "x", metric: "y", value: 3, exact: 1 }]);
    expect(s.empty).toBe(false);
    expect(s.other).toEqual([{ label: "x/y", value: "3", estimate: false }]);
  });
});

describe("groupLiveStream", () => {
  it("collapses consecutive same-tool calls, keeps text", () => {
    const items = groupLiveStream([
      "Looking at the files.",
      "→ Read: a.ts",
      "→ Read: b.ts",
      "→ Bash: ls",
      "Done.",
    ]);
    expect(items).toEqual([
      { kind: "text", text: "Looking at the files." },
      { kind: "tool", tool: "Read", count: 2, calls: ["a.ts", "b.ts"] },
      { kind: "tool", tool: "Bash", count: 1, calls: ["ls"] },
      { kind: "text", text: "Done." },
    ]);
  });

  it("handles tool lines without args and multiline chunks", () => {
    const items = groupLiveStream(["→ Read\n→ Read", "line1\nline2"]);
    expect(items).toEqual([
      { kind: "tool", tool: "Read", count: 2, calls: [] },
      { kind: "text", text: "line1\nline2" },
    ]);
  });

  it("returns empty for no lines", () => {
    expect(groupLiveStream([])).toEqual([{ kind: "text", text: "" }]);
  });
});
