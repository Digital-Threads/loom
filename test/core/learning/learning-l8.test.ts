import { describe, it, expect } from "vitest";
import { outcomesFromEvents, computePriors, applyPriors } from "../../../src/core/learning/priors.js";
import { chooseRoute, type RouteCandidate } from "../../../src/core/automation/router.js";
import type { LoomEvent } from "../../../src/core/spine/event.js";

const ev = (profile: string, failed: number): LoomEvent => ({
  schema: "loom.event.v1", ts: 1, source: "loom", projectId: "p1", profileId: profile,
  type: "run.completed", severity: failed ? "error" : "info", metrics: { failed },
});

describe("learning priors (L8)", () => {
  it("derives outcomes from run.completed events", () => {
    const outcomes = outcomesFromEvents([ev("work", 0), ev("work", 1), ev("main", 0), { schema: "loom.event.v1", ts: 1, source: "loom", projectId: "p1", type: "step.completed" }]);
    expect(outcomes).toEqual([
      { profile: "work", success: true },
      { profile: "work", success: false },
      { profile: "main", success: true },
    ]);
  });

  it("history of failures inflates a profile's cost so the router avoids it", () => {
    // work: 1/3 success (unreliable); main: 2/2 success (reliable). Equal base cost.
    const events = [ev("work", 0), ev("work", 1), ev("work", 1), ev("main", 0), ev("main", 0)];
    const priors = computePriors(outcomesFromEvents(events));
    const candidates: RouteCandidate[] = [
      { profile: "work", costPerUnit: 1 },
      { profile: "main", costPerUnit: 1 },
    ];
    const adjusted = applyPriors(candidates, priors);
    expect(chooseRoute({}, adjusted)?.profile).toBe("main"); // reliable wins despite equal base
  });

  it("no/insufficient history leaves routing unchanged", () => {
    const candidates: RouteCandidate[] = [{ profile: "a", costPerUnit: 1 }, { profile: "b", costPerUnit: 2 }];
    const adjusted = applyPriors(candidates, computePriors([]));
    expect(chooseRoute({}, adjusted)?.profile).toBe("a"); // cheapest, no prior influence
  });
});
