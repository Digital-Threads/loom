import { describe, it, expect } from "vitest";
import { chooseRoute, type RouteCandidate } from "../../../src/core/automation/router.js";

describe("chooseRoute", () => {
  const cands: RouteCandidate[] = [
    { profile: "work", model: "opus", costPerUnit: 10, quotaRemaining: 5 },
    { profile: "personal", model: "sonnet", costPerUnit: 4, quotaRemaining: 5 },
    { profile: "google", model: "gemini", costPerUnit: 1, quotaRemaining: 0 }, // exhausted
  ];

  it("picks the cheapest profile with quota", () => {
    expect(chooseRoute({}, cands)).toEqual({ profile: "personal", model: "sonnet" });
  });

  it("excludes profiles with zero quota even if cheapest", () => {
    const choice = chooseRoute({}, cands);
    expect(choice!.profile).not.toBe("google");
  });

  it("honors an explicit model override", () => {
    expect(chooseRoute({ model: "haiku" }, cands)).toEqual({ profile: "personal", model: "haiku" });
  });

  it("filters by required capability", () => {
    const c: RouteCandidate[] = [
      { profile: "a", costPerUnit: 1, capabilities: ["text"] },
      { profile: "b", costPerUnit: 5, capabilities: ["browser"] },
    ];
    expect(chooseRoute({ capability: "browser" }, c)).toEqual({ profile: "b", model: undefined });
  });

  it("treats a candidate without declared capabilities as capable", () => {
    const c: RouteCandidate[] = [{ profile: "any", costPerUnit: 2 }];
    expect(chooseRoute({ capability: "anything" }, c)).toEqual({ profile: "any", model: undefined });
  });

  it("returns null when nothing is eligible", () => {
    expect(chooseRoute({}, [{ profile: "x", quotaRemaining: 0 }])).toBeNull();
    expect(chooseRoute({ capability: "z" }, [{ profile: "x", capabilities: ["y"] }])).toBeNull();
  });

  it("unknown cost sorts after known cheap", () => {
    const c: RouteCandidate[] = [
      { profile: "unknown" },
      { profile: "cheap", costPerUnit: 3 },
    ];
    expect(chooseRoute({}, c)!.profile).toBe("cheap");
  });
});
