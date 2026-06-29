import { describe, it, expect } from "vitest";
import { isCrossCli, buildHandoffSeed } from "../../../src/core/automation/cross-cli-handoff.js";

describe("isCrossCli", () => {
  it("is true only when both clis are present and differ", () => {
    expect(isCrossCli("claude", "codex")).toBe(true);
    expect(isCrossCli("claude", "claude")).toBe(false); // same CLI → native resume
    expect(isCrossCli(undefined, "codex")).toBe(false);  // no source → not a handoff
    expect(isCrossCli("claude", null)).toBe(false);
  });
});

describe("buildHandoffSeed", () => {
  it("assembles the present sections in order, skipping empty ones", () => {
    const seed = buildHandoffSeed({ spec: "do X", analysis: "found Y", specMd: "", lastMessage: "  " });
    expect(seed).toContain("TASK:\ndo X");
    expect(seed).toContain("ANALYSIS:\nfound Y");
    expect(seed).not.toContain("SPEC:");          // empty → skipped
    expect(seed).not.toContain("LAST MESSAGE:");   // whitespace → skipped
    expect(seed.indexOf("TASK:")).toBeLessThan(seed.indexOf("ANALYSIS:")); // order preserved
  });

  it("trims an over-budget section and marks it", () => {
    const seed = buildHandoffSeed({ spec: "x".repeat(5000) }, 100);
    expect(seed.length).toBeLessThan(5000);
    expect(seed).toContain("…(trimmed)");
  });

  it("returns empty when there's nothing to hand off", () => {
    expect(buildHandoffSeed({ spec: "" })).toBe("");
  });
});
