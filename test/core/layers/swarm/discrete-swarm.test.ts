import { describe, it, expect } from "vitest";
import { runDiscreteSwarm, perspectivePrompt } from "../../../../src/core/layers/swarm/discrete-swarm.js";
import { SWARM_STAGE_DEFAULT } from "../../../../src/core/layers/swarm/config.js";

const cfg = (attempts: number, perspectives: string[] = []) => ({ ...SWARM_STAGE_DEFAULT, enabled: true, attempts, perspectives });

describe("runDiscreteSwarm (L5 discrete fan-out)", () => {
  it("runs N attempts with their index-aligned perspectives, collects outputs", async () => {
    const seen: Array<[number, string | undefined]> = [];
    const r = await runDiscreteSwarm(cfg(3, ["security", "perf"]), async (i, p) => { seen.push([i, p]); return `out-${i}`; });
    expect(r).toEqual({ outputs: ["out-0", "out-1", "out-2"], attempts: 3, survivors: 3 });
    expect(seen.sort()).toEqual([[0, "security"], [1, "perf"], [2, undefined]]); // 3rd attempt has no perspective
  });

  it("drops a failed attempt but keeps the survivors (partial failure)", async () => {
    const r = await runDiscreteSwarm(cfg(3), async (i) => { if (i === 1) throw new Error("boom"); return `ok-${i}`; });
    expect(r.attempts).toBe(3);
    expect(r.survivors).toBe(2);
    expect(r.outputs).toEqual(["ok-0", "ok-2"]);
  });

  it("clamps a zero/negative attempt count to at least one", async () => {
    const r = await runDiscreteSwarm({ ...SWARM_STAGE_DEFAULT, attempts: 0 }, async () => "x");
    expect(r.attempts).toBe(1);
  });

  it("perspectivePrompt appends a lens only when a perspective is given", () => {
    expect(perspectivePrompt("review the diff", "security")).toContain('"security" lens');
    expect(perspectivePrompt("review the diff", undefined)).toBe("review the diff");
    expect(perspectivePrompt("review the diff", "  ")).toBe("review the diff"); // blank → no lens
  });
});
