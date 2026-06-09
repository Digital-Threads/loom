import { describe, it, expect } from "vitest";
import { loomRegistry } from "../../../src/core/plugins/index.js";

describe("plugin contract v1", () => {
  it("registry contains 3 plugins with the expected ids", () => {
    expect(loomRegistry.list().map((p) => p.id).sort()).toEqual(
      ["aimux", "task-journal", "token-pilot"],
    );
  });

  it("token-pilot has a non-empty settings.schema", () => {
    const tp = loomRegistry.get("token-pilot");
    expect(tp).toBeDefined();
    expect(tp!.settings).toBeDefined();
    expect(tp!.settings!.schema.fields.length).toBeGreaterThan(0);
  });

  it("aimux and task-journal have an empty settings.schema", () => {
    expect(loomRegistry.get("aimux")!.settings!.schema.fields.length).toBe(0);
    expect(loomRegistry.get("task-journal")!.settings!.schema.fields.length).toBe(0);
  });

  it("every plugin has a non-empty tabs[] and a load function", () => {
    for (const p of loomRegistry.list()) {
      expect(p.tabs.length).toBeGreaterThan(0);
      expect(typeof p.load).toBe("function");
      for (const tab of p.tabs) {
        expect(typeof tab.id).toBe("string");
        expect(typeof tab.title).toBe("string");
      }
    }
  });

  it("actions: aimux/task-journal non-empty, token-pilot empty", () => {
    expect(loomRegistry.get("aimux")!.actions!.length).toBeGreaterThan(0);
    expect(loomRegistry.get("task-journal")!.actions!.length).toBeGreaterThan(0);
    expect(loomRegistry.get("token-pilot")!.actions!.length).toBe(0);
  });

  it("aimux contains the addSubscription action", () => {
    const ids = loomRegistry.get("aimux")!.actions!.map((a) => a.id);
    expect(ids).toContain("addSubscription");
  });

  it("task-journal: the closeTask action requires confirmation", () => {
    const close = loomRegistry.get("task-journal")!.actions!.find((a) => a.id === "closeTask");
    expect(close).toBeDefined();
    expect(close!.confirm).toBe(true);
  });
});
