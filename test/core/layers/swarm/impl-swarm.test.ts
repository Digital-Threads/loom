import { describe, it, expect, vi } from "vitest";
import { runImplSwarm, type ImplSwarmDeps } from "../../../../src/core/layers/swarm/impl-swarm.js";

function deps(over: Partial<ImplSwarmDeps> = {}): ImplSwarmDeps {
  return {
    attempts: 3,
    perspectives: [],
    implement: async (slot) => ({ branch: `loom/t/sw${slot}`, output: `impl-${slot}` }),
    qaGate: async () => ({ green: true, summary: "all green" }),
    judge: async (greens) => ({ winnerSlot: greens[0].slot, rationale: "first green" }),
    ...over,
  };
}

describe("runImplSwarm (impl-as-swarm engine)", () => {
  it("elects the judge's winner among the green candidates", async () => {
    const judge = vi.fn(async () => ({ winnerSlot: 2, rationale: "cleanest diff" }));
    const r = await runImplSwarm(deps({ judge }));
    expect(judge).toHaveBeenCalledOnce();
    expect(r.winner?.slot).toBe(2);
    expect(r.rationale).toBe("cleanest diff");
    expect(r.attempts).toHaveLength(3);
  });

  it("skips the judge when exactly one candidate passes QA", async () => {
    const judge = vi.fn(async () => ({ winnerSlot: 0, rationale: "x" }));
    const r = await runImplSwarm(deps({ judge, qaGate: async (slot) => ({ green: slot === 1, summary: slot === 1 ? "green" : "red" }) }));
    expect(judge).not.toHaveBeenCalled();
    expect(r.winner?.slot).toBe(1);
    expect(r.rationale).toMatch(/only one/);
  });

  it("returns no winner when nothing passes QA (caller falls back)", async () => {
    const r = await runImplSwarm(deps({ qaGate: async () => ({ green: false, summary: "tests failed" }) }));
    expect(r.winner).toBeNull();
    expect(r.attempts).toHaveLength(3); // all ran, all red
    expect(r.rationale).toMatch(/no candidate/);
  });

  it("drops an attempt that throws while implementing, elects from survivors", async () => {
    const r = await runImplSwarm(deps({
      attempts: 3,
      implement: async (slot) => { if (slot === 1) throw new Error("impl crashed"); return { branch: `b${slot}`, output: `o${slot}` }; },
      judge: async (greens) => ({ winnerSlot: greens[greens.length - 1].slot, rationale: "last" }),
    }));
    expect(r.attempts.map((a) => a.slot).sort()).toEqual([0, 2]); // slot 1 dropped
    expect(r.winner?.slot).toBe(2);
  });

  it("passes index-aligned perspectives to implement", async () => {
    const seen: Array<string | undefined> = [];
    await runImplSwarm(deps({ attempts: 2, perspectives: ["perf"], implement: async (slot, p) => { seen[slot] = p; return { branch: `b${slot}`, output: "o" }; } }));
    expect(seen).toEqual(["perf", undefined]);
  });
});
