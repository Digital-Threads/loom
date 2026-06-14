import { describe, it, expect } from "vitest";
import { computePriors, applyPriors, priorKey } from "../../../src/core/learning/priors.js";
import { chooseRoute, type RouteCandidate } from "../../../src/core/automation/router.js";

describe("computePriors", () => {
  it("aggregates success rate per profile and profile|model", () => {
    const priors = computePriors([
      { profile: "work", model: "opus", success: true },
      { profile: "work", model: "opus", success: false },
      { profile: "personal", model: "sonnet", success: true },
    ]);
    expect(priors.get("work")).toEqual({ success: 1, total: 2, rate: 0.5 });
    expect(priors.get(priorKey("work", "opus"))).toEqual({ success: 1, total: 2, rate: 0.5 });
    expect(priors.get("personal")!.rate).toBe(1);
  });
});

describe("applyPriors", () => {
  const cands: RouteCandidate[] = [
    { profile: "work", costPerUnit: 4 },
    { profile: "personal", costPerUnit: 5 },
  ];

  it("inflates cost by failure rate (>= minRuns)", () => {
    const priors = computePriors([
      { profile: "work", success: false },
      { profile: "work", success: false }, // rate 0 → ×2
    ]);
    const out = applyPriors(cands, priors);
    expect(out.find((c) => c.profile === "work")!.costPerUnit).toBe(8); // 4 × 2
    expect(out.find((c) => c.profile === "personal")!.costPerUnit).toBe(5); // unchanged (no prior)
  });

  it("leaves cost unchanged below minRuns", () => {
    const priors = computePriors([{ profile: "work", success: false }]); // 1 run
    expect(applyPriors(cands, priors, { minRuns: 2 })[0].costPerUnit).toBe(4);
  });

  it("flips the router's choice toward the reliable profile", () => {
    // work is cheaper (4 vs 5) but unreliable; learning should make the router pick personal.
    const priors = computePriors([
      { profile: "work", success: false },
      { profile: "work", success: false },
    ]);
    const adjusted = applyPriors(cands, priors);
    expect(chooseRoute({}, adjusted)!.profile).toBe("personal");
  });
});
