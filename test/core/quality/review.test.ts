import { describe, it, expect } from "vitest";
import {
  runReviewPasses,
  dedupeFindings,
  type ReviewPass,
  type Finding,
} from "../../../src/core/quality/review.js";

function pass(key: string, findings: Finding[]): ReviewPass {
  return { key, run: async () => findings };
}

describe("dedupeFindings", () => {
  it("collapses identical severity+file+message", () => {
    const f: Finding[] = [
      { pass: "review", severity: "bug", message: "no null check", file: "a.ts" },
      { pass: "adversarial", severity: "bug", message: "no null check", file: "a.ts" },
      { pass: "review", severity: "warn", message: "dup", file: "b.ts" },
    ];
    expect(dedupeFindings(f)).toHaveLength(2);
  });
});

describe("runReviewPasses", () => {
  it("aggregates, dedupes, counts and sorts by severity", async () => {
    const res = await runReviewPasses([
      pass("review", [
        { pass: "review", severity: "warn", message: "style" },
        { pass: "review", severity: "bug", message: "off-by-one", file: "x.ts" },
      ]),
      pass("simplify", [{ pass: "simplify", severity: "info", message: "extract fn" }]),
    ]);
    expect(res.counts).toEqual({ bug: 1, warn: 1, info: 1 });
    expect(res.passed).toBe(false); // a bug remains
    expect(res.findings[0].severity).toBe("bug"); // sorted bug-first
  });

  it("passes when no bug-severity findings", async () => {
    const res = await runReviewPasses([pass("review", [{ pass: "review", severity: "warn", message: "nit" }])]);
    expect(res.passed).toBe(true);
    expect(res.counts.warn).toBe(1);
  });

  it("a throwing pass becomes a warn, not an abort", async () => {
    const boom: ReviewPass = { key: "ralph", run: async () => { throw new Error("timeout"); } };
    const res = await runReviewPasses([boom, pass("review", [])]);
    expect(res.passed).toBe(true);
    expect(res.findings.some((f) => f.severity === "warn" && f.message.includes("pass failed"))).toBe(true);
  });

  it("empty passes → passed with zero counts", async () => {
    const res = await runReviewPasses([]);
    expect(res).toEqual({ findings: [], counts: { bug: 0, warn: 0, info: 0 }, passed: true });
  });
});
