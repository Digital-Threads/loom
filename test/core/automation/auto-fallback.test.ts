import { describe, it, expect } from "vitest";
import { pickFallbackProfile, shouldAutoFallback } from "../../../src/core/automation/auto-fallback.js";

describe("pickFallbackProfile", () => {
  it("picks the first OTHER allowed profile with headroom", () => {
    const limits = [
      { profile: "work", status: "rejected", fiveHourPct: 100 },
      { profile: "dt", status: "rejected", fiveHourPct: 100 },
      { profile: "main", status: "allowed", fiveHourPct: 2 },
    ];
    expect(pickFallbackProfile(limits, "work")).toBe("main");
  });

  it("never returns the current profile", () => {
    const limits = [{ profile: "main", status: "allowed", fiveHourPct: 2 }];
    expect(pickFallbackProfile(limits, "main")).toBeNull();
  });

  it("returns null when no other profile has headroom (single sub / all exhausted)", () => {
    expect(pickFallbackProfile([{ profile: "work", status: "rejected", fiveHourPct: 100 }], "work")).toBeNull();
    expect(pickFallbackProfile([
      { profile: "work", status: "rejected" },
      { profile: "dt", status: "allowed", fiveHourPct: 99 }, // over the headroom bar
    ], "work")).toBeNull();
  });

  it("names are taken from the input, never hardcoded", () => {
    const limits = [{ profile: "alice-personal", status: "allowed", fiveHourPct: 0 }];
    expect(pickFallbackProfile(limits, "bob-work")).toBe("alice-personal");
  });
});

describe("shouldAutoFallback", () => {
  it("waits out the grace window before auto-switching", () => {
    expect(shouldAutoFallback(1000, 1000 + 59_000)).toBe(false);
    expect(shouldAutoFallback(1000, 1000 + 60_000)).toBe(true);
  });
});
