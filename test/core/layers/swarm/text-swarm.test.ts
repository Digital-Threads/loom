import { describe, it, expect } from "vitest";
import { pickWinner, runTextSwarm } from "../../../../src/core/layers/swarm/text-swarm.js";

describe("pickWinner", () => {
  it("parses a 1-based number into a 0-based index", () => {
    expect(pickWinner("2", 3)).toBe(1);
    expect(pickWinner("#1", 3)).toBe(0);
    expect(pickWinner("The best is candidate 3 — cleanest.", 3)).toBe(2);
  });
  it("falls back to the first candidate on garbage or out-of-range", () => {
    expect(pickWinner("none of them", 3)).toBe(0); // no number
    expect(pickWinner("9", 3)).toBe(0);            // out of range
    expect(pickWinner("0", 3)).toBe(0);            // 0 → -1 → out of range → 0
  });
});

describe("runTextSwarm", () => {
  it("returns null when no attempt yields usable text (caller falls back)", async () => {
    const r = await runTextSwarm({ attempts: 3 }, async () => "   ", async () => "1");
    expect(r).toBeNull();
  });

  it("skips the judge when only one candidate is non-empty", async () => {
    let judged = 0;
    const r = await runTextSwarm(
      { attempts: 3 },
      async (i) => (i === 1 ? "the only real spec" : ""),
      async () => { judged++; return "1"; },
    );
    expect(r).toEqual({ winner: "the only real spec", index: 0, candidates: ["the only real spec"] });
    expect(judged).toBe(0); // no judge call for a single survivor
  });

  it("runs the judge and returns its elected candidate", async () => {
    const seen: string[][] = [];
    const r = await runTextSwarm(
      { attempts: 3, perspectives: ["a", "b", "c"] },
      async (i, p) => `spec-${i}-${p}`,
      async (cands) => { seen.push(cands); return "pick #2"; },
    );
    expect(r?.candidates).toEqual(["spec-0-a", "spec-1-b", "spec-2-c"]);
    expect(r?.index).toBe(1);
    expect(r?.winner).toBe("spec-1-b");
    expect(seen[0]).toHaveLength(3); // judge saw all three
  });

  it("drops a throwing attempt and judges the survivors", async () => {
    const r = await runTextSwarm(
      { attempts: 3 },
      async (i) => { if (i === 0) throw new Error("agent died"); return `spec-${i}`; },
      async () => "1",
    );
    expect(r?.candidates).toEqual(["spec-1", "spec-2"]);
    expect(r?.winner).toBe("spec-1"); // judge "1" → index 0 of the survivors
  });

  it("falls back to the first candidate when the judge throws", async () => {
    const r = await runTextSwarm(
      { attempts: 2 },
      async (i) => `spec-${i}`,
      async () => { throw new Error("judge died"); },
    );
    expect(r?.index).toBe(0);
    expect(r?.winner).toBe("spec-0");
  });
});
