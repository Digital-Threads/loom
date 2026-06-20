import { describe, it, expect } from "vitest";
import { swarmRunEvent, sumAttemptCost } from "../../../../src/core/layers/swarm/events.js";

describe("swarm spine events (L5)", () => {
  it("sumAttemptCost sums defined per-attempt costs, skips junk", () => {
    expect(sumAttemptCost([1.5, undefined, 0.5, NaN])).toBe(2);
    expect(sumAttemptCost([])).toBe(0);
  });

  it("swarmRunEvent builds a swarm.* event with the metrics the UI reads", () => {
    const e = swarmRunEvent({ projectId: "p", taskId: "t", stage: "review", attempts: 3, survivors: 3, agree: 2, winner: "attempt-1", costUsd: 1.2, ts: 100 });
    expect(e.schema).toBe("loom.event.v1");
    expect(e.type).toBe("swarm.run"); // matches Swarm.tsx filter (type.startsWith("swarm."))
    expect(e.type.startsWith("swarm.")).toBe(true);
    // Swarm.tsx renders metrics.{count,total,ratio} as "<count>/<total> agreement" / "<pct>%"
    expect(e.metrics).toMatchObject({ attempts: 3, count: 2, total: 3, costUsd: 1.2 });
    expect(e.metrics!.ratio).toBeCloseTo(2 / 3);
    expect(e.message).toContain("Swarm review");
    expect(e.message).toContain("elected attempt-1");
  });

  it("clamps agreement count to [0,total] and ratio is 0 with no survivors", () => {
    const e = swarmRunEvent({ projectId: "p", taskId: "t", stage: "analysis", attempts: 3, survivors: 0, agree: 5, ts: 1 });
    expect(e.metrics).toMatchObject({ count: 0, total: 0, ratio: 0 });
  });
});
