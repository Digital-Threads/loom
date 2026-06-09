import { describe, it, expect } from "vitest";
import { layerOf, LAYER_ORDER, groupTabsByLayer } from "../../../src/core/dashboard/layers.js";

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

const plugins = [
  { id: "task-journal", category: "memory", tabs: [{ id: "tasks", title: "Tasks" }] },
  { id: "aimux", category: "accounts", tabs: [{ id: "subs", title: "Subscriptions" }, { id: "sess", title: "Sessions" }] },
  { id: "token-pilot", category: "efficiency", tabs: [{ id: "tok", title: "Tokens" }] },
] as any[];

describe("groupTabsByLayer", () => {
  it("orders groups by LAYER_ORDER regardless of registry order", () => {
    expect(groupTabsByLayer(plugins).map((g) => g.layer)).toEqual(["accounts", "efficiency", "memory"]);
  });
  it("keeps tab order within a plugin and flattens to a stable tab list", () => {
    const flat = groupTabsByLayer(plugins).flatMap((g) => g.tabs.map((t) => t.title));
    expect(flat).toEqual(["Subscriptions", "Sessions", "Tokens", "Tasks"]);
  });
  it("omits empty layers", () => {
    expect(groupTabsByLayer(plugins).some((g) => g.layer === "learning")).toBe(false);
  });
});
