import { describe, it, expect } from "vitest";
import { overviewView } from "../../../src/ui/views/host-views.js";

describe("overviewView (by-layer)", () => {
  it("references layerSummaryLines (per-layer summary)", () => {
    expect(JSON.stringify(overviewView)).toMatch(/layerSummaryLines/);
  });
});
