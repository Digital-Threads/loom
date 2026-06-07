import { describe, it, expect } from "vitest";
import { layerOf, LAYER_ORDER } from "../../../src/core/dashboard/layers.js";

describe("layerOf", () => {
  it("returns plugin.category when present", () => {
    expect(layerOf({ id: "token-pilot", category: "efficiency" } as any)).toBe("efficiency");
  });
  it("falls back by known plugin id when category missing", () => {
    expect(layerOf({ id: "aimux" } as any)).toBe("accounts");
    expect(layerOf({ id: "task-journal" } as any)).toBe("memory");
  });
  it("falls back to 'undefined' for unknown plugin without category", () => {
    expect(layerOf({ id: "mystery" } as any)).toBe("undefined");
  });
  it("LAYER_ORDER lists accounts before efficiency before memory", () => {
    expect(LAYER_ORDER.indexOf("accounts")).toBeLessThan(LAYER_ORDER.indexOf("efficiency"));
    expect(LAYER_ORDER.indexOf("efficiency")).toBeLessThan(LAYER_ORDER.indexOf("memory"));
  });
});
