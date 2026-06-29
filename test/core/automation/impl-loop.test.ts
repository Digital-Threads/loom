import { describe, it, expect } from "vitest";
import { runImplLoop, type ImplLoopDeps } from "../../../src/core/automation/impl-loop.js";

// Drives runImplLoop with scripted send()/verify() so the verify gate's behaviour
// is asserted directly (no live agent, no worktree). settled = reply is "DONE".
function harness(opts: {
  replies: string[];                                  // send() returns these in order (last repeats)
  verify: Array<{ ok: boolean; failures: string }>;   // verify() returns these in order (last repeats)
  overBudgetAt?: number;                              // send-count at/after which overBudget() is true
}) {
  const sent: string[] = [];
  let sendN = 0, verifyN = 0;
  const at = <T,>(arr: T[], i: number) => arr[Math.min(i, arr.length - 1)];
  const deps: ImplLoopDeps = {
    send: async (p) => { sent.push(p); return at(opts.replies, sendN++); },
    verify: async () => at(opts.verify, verifyN++),
    settled: (t) => t === "DONE",
    overBudget: () => opts.overBudgetAt !== undefined && sendN >= opts.overBudgetAt,
    prompts: { first: "FIRST", cont: "CONT", fail: (f) => `FAIL:${f}` },
    maxContinues: 6,
  };
  return { deps, sent, verifyCount: () => verifyN };
}

describe("runImplLoop — impl verify gate", () => {
  it("clean done: agent reports done AND verify passes → verified, only the first send", async () => {
    const h = harness({ replies: ["DONE"], verify: [{ ok: true, failures: "" }] });
    const r = await runImplLoop(h.deps);
    expect(r.verified).toBe(true);
    expect(h.sent).toEqual(["FIRST"]);
    expect(h.verifyCount()).toBe(1); // verified exactly once
  });

  it("self-heals: claimed done but verify FAILS, the real failure is fed back, then passes → verified", async () => {
    const h = harness({ replies: ["DONE", "DONE"], verify: [{ ok: false, failures: "1 test failed" }, { ok: true, failures: "" }] });
    const r = await runImplLoop(h.deps);
    expect(r.verified).toBe(true);
    expect(h.sent[0]).toBe("FIRST");
    expect(h.sent[1]).toBe("FAIL:1 test failed"); // the agent got the actual failure output, not a vague nudge
    expect(h.verifyCount()).toBe(2);
  });

  it("does NOT trust a 'done' that never verifies: parks (not verified, not budget)", async () => {
    const h = harness({ replies: ["DONE"], verify: [{ ok: false, failures: "boom" }] });
    const r = await runImplLoop(h.deps);
    expect(r.verified).toBe(false);
    expect(r.budgetHit).toBe(false);
    expect(h.sent.filter((p) => p.startsWith("FAIL:")).length).toBeGreaterThan(0); // kept feeding failures, didn't ship
  });

  it("doesn't verify while the agent isn't settled — sends CONT instead", async () => {
    const h = harness({ replies: ["NOT", "NOT", "DONE"], verify: [{ ok: true, failures: "" }] });
    const r = await runImplLoop(h.deps);
    expect(r.verified).toBe(true);
    expect(h.sent[1]).toBe("CONT");
    expect(h.sent[2]).toBe("CONT");
    expect(h.verifyCount()).toBe(1); // verified only once the agent finally reported done
  });

  it("parks on the cost cap mid-loop: budgetHit, not verified", async () => {
    const h = harness({ replies: ["NOT"], verify: [{ ok: true, failures: "" }], overBudgetAt: 1 });
    const r = await runImplLoop(h.deps);
    expect(r.budgetHit).toBe(true);
    expect(r.verified).toBe(false);
  });
});
