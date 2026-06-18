import { describe, it, expect } from "vitest";
import { runSwarmStep, SWARM_DEFAULT } from "../../../../src/core/layers/swarm/swarm-step.js";

describe("runSwarmStep (L5)", () => {
  it("fans out N attempts and elects the majority by default", async () => {
    const r = await runSwarmStep({ attempts: 5 }, async (i) => (i === 0 ? "B" : "A"));
    expect(r.value).toBe("A");
    expect(r.consensus.count).toBe(4);
    expect(r.consensus.total).toBe(5);
    expect(r.outcomes).toHaveLength(5);
  });

  it("passes per-attempt perspectives", async () => {
    const seen: (string | undefined)[] = [];
    await runSwarmStep({ attempts: 2, perspectives: ["security", "perf"] }, async (i, p) => { seen.push(p); return i; });
    expect(seen).toEqual(["security", "perf"]);
  });

  it("uses a custom synthesize (coordinator fan-in) when provided", async () => {
    const r = await runSwarmStep({ attempts: 3 }, async (i) => i + 1, (vals) => vals.reduce((a, b) => a + b, 0));
    expect(r.value).toBe(6); // 1+2+3
  });

  it("captures failures per attempt and still elects from survivors", async () => {
    const r = await runSwarmStep({ attempts: 3 }, async (i) => { if (i === 1) throw new Error("boom"); return "ok"; });
    expect(r.value).toBe("ok");
    expect(r.outcomes.filter((o) => o.error).length).toBe(1);
  });

  it("value is undefined when every attempt fails", async () => {
    const r = await runSwarmStep({ attempts: 2 }, async () => { throw new Error("x"); });
    expect(r.value).toBeUndefined();
  });

  it("default config is 3 attempts", () => {
    expect(SWARM_DEFAULT.attempts).toBe(3);
  });
});
