import { describe, it, expect } from "vitest";
import { resolveFlow, FLOW_DEFAULTS } from "../../../../src/core/layers/quality/flow-config.js";
import { runReview, reviewAction, reviewHolds, type PassFactory } from "../../../../src/core/layers/quality/review-runner.js";
import { runQa, type QaCheck } from "../../../../src/core/layers/quality/qa-runner.js";
import type { Finding } from "../../../../src/core/layers/quality/review.js";

describe("flow-config resolver (L6.1)", () => {
  it("per-task override wins over column default and built-ins", () => {
    expect(resolveFlow("review", { passes: ["normal"] }, { passes: ["adversarial", "ralph"] })).toEqual(["adversarial", "ralph"]);
  });
  it("falls back to column default, then built-in", () => {
    expect(resolveFlow("review", { passes: ["normal", "simplify"] })).toEqual(["normal", "simplify"]);
    expect(resolveFlow("review")).toEqual(FLOW_DEFAULTS.review);
    expect(resolveFlow("qa")).toEqual(["tests", "build"]);
    expect(resolveFlow("unknown")).toEqual([]);
  });
});

describe("review-runner (L6.2/6.3)", () => {
  const makePass: PassFactory = (key) => ({
    key,
    async run(): Promise<Finding[]> {
      return key === "adversarial" ? [{ pass: key, severity: "bug", message: "leak" }] : [{ pass: key, severity: "info", message: "ok" }];
    },
  });

  it("runs resolved passes, dedupes, and computes the verdict", async () => {
    const clean = await runReview(["normal", "simplify"], makePass);
    expect(clean.passed).toBe(true);
    const withBug = await runReview(["normal", "adversarial"], makePass);
    expect(withBug.passed).toBe(false);
    expect(withBug.counts.bug).toBe(1);
  });

  it("reviewAction: accept when clean; autofix/return per mode when not", async () => {
    const clean = await runReview(["normal"], makePass);
    expect(reviewAction(clean, "triage")).toBe("accept");
    const bug = await runReview(["adversarial"], makePass);
    expect(reviewAction(bug, "autofix")).toBe("autofix");
    expect(reviewAction(bug, "triage")).toBe("return");
  });

  it("reviewHolds: bugs always hold; warn/info hold unless autopilot; truly clean never holds", async () => {
    const emptyPass: PassFactory = (key) => ({ key, async run(): Promise<Finding[]> { return []; } });
    const clean = await runReview(["normal"], emptyPass); // passed, 0 findings
    expect(reviewHolds(clean, "gated")).toBe(false);
    expect(reviewHolds(clean, "autopilot")).toBe(false);

    const withInfo = await runReview(["normal"], makePass); // passed, 1 info finding
    expect(withInfo.passed).toBe(true);
    expect(reviewHolds(withInfo, "gated")).toBe(true);
    expect(reviewHolds(withInfo, "manual")).toBe(true);
    expect(reviewHolds(withInfo, "autopilot")).toBe(false); // autopilot runs through non-blockers

    const bug = await runReview(["adversarial"], makePass); // !passed
    expect(reviewHolds(bug, "autopilot")).toBe(true); // blockers hold even in autopilot
  });
});

describe("qa-runner (L6.4)", () => {
  const ok: QaCheck = { key: "tests", async run() { return { ok: true, output: "42 passed" }; } };
  const bad: QaCheck = { key: "build", async run() { return { ok: false, output: "tsc error" }; } };
  const boom: QaCheck = { key: "browser", async run() { throw new Error("canary crashed"); } };

  it("passes only when every check passes; a throw is a failure", async () => {
    expect((await runQa([ok])).passed).toBe(true);
    const r = await runQa([ok, bad, boom]);
    expect(r.passed).toBe(false);
    expect(r.results.find((x) => x.key === "browser")?.output).toMatch(/canary crashed/);
  });
});
