import { describe, it, expect } from "vitest";
import { overviewView } from "../../../src/ui/views/host-views.js";

describe("overviewView (by-layer)", () => {
  it("references layerSummaryLines (по-слойная сводка)", () => {
    expect(JSON.stringify(overviewView)).toMatch(/layerSummaryLines/);
  });
});
