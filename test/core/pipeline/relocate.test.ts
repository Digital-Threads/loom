import { describe, it, expect } from "vitest";
import { parseRelocate, relocateAllowed, RELOCATE_BUDGET } from "../../../src/core/pipeline/relocate.js";

describe("pipeline/relocate (agent self-steering)", () => {
  it("parses a valid directive (stage + reason)", () => {
    expect(parseRelocate("...done\nLOOM-RELOCATE: analysis | spec missed concurrency")).toEqual({
      stage: "analysis",
      reason: "spec missed concurrency",
    });
  });

  it("tolerates leading markup and case", () => {
    expect(parseRelocate("- LOOM-RELOCATE: Impl | fixable null check")).toEqual({
      stage: "impl",
      reason: "fixable null check",
    });
  });

  it("ignores an unknown stage", () => {
    expect(parseRelocate("LOOM-RELOCATE: nowhere | because")).toBeNull();
  });

  it("ignores an empty reason (a move must be justified)", () => {
    expect(parseRelocate("LOOM-RELOCATE: analysis |   ")).toBeNull();
  });

  it("returns null when there is no directive", () => {
    expect(parseRelocate("just a normal report, no directive")).toBeNull();
  });

  it("budget caps self-relocations (loop guard)", () => {
    expect(relocateAllowed(0)).toBe(true);
    expect(relocateAllowed(RELOCATE_BUDGET - 1)).toBe(true);
    expect(relocateAllowed(RELOCATE_BUDGET)).toBe(false);
  });
});
