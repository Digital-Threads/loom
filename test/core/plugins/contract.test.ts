import { describe, it, expect } from "vitest";
import { loomRegistry } from "../../../src/core/plugins/index.js";

describe("plugin-контракт v1", () => {
  it("registry содержит 3 плагина с ожидаемыми id", () => {
    expect(loomRegistry.list().map((p) => p.id).sort()).toEqual(
      ["aimux", "task-journal", "token-pilot"],
    );
  });

  it("token-pilot имеет непустую settings.schema", () => {
    const tp = loomRegistry.get("token-pilot");
    expect(tp).toBeDefined();
    expect(tp!.settings).toBeDefined();
    expect(tp!.settings!.schema.fields.length).toBeGreaterThan(0);
  });

  it("aimux и task-journal имеют пустую settings.schema", () => {
    expect(loomRegistry.get("aimux")!.settings!.schema.fields.length).toBe(0);
    expect(loomRegistry.get("task-journal")!.settings!.schema.fields.length).toBe(0);
  });

  it("каждый плагин имеет непустой tabs[] и load-функцию", () => {
    for (const p of loomRegistry.list()) {
      expect(p.tabs.length).toBeGreaterThan(0);
      expect(typeof p.load).toBe("function");
      for (const tab of p.tabs) {
        expect(typeof tab.id).toBe("string");
        expect(typeof tab.title).toBe("string");
      }
    }
  });

  it("actions: aimux/task-journal непустые, token-pilot пустой", () => {
    expect(loomRegistry.get("aimux")!.actions!.length).toBeGreaterThan(0);
    expect(loomRegistry.get("task-journal")!.actions!.length).toBeGreaterThan(0);
    expect(loomRegistry.get("token-pilot")!.actions!.length).toBe(0);
  });

  it("aimux содержит action addSubscription", () => {
    const ids = loomRegistry.get("aimux")!.actions!.map((a) => a.id);
    expect(ids).toContain("addSubscription");
  });

  it("task-journal: action closeTask требует подтверждения", () => {
    const close = loomRegistry.get("task-journal")!.actions!.find((a) => a.id === "closeTask");
    expect(close).toBeDefined();
    expect(close!.confirm).toBe(true);
  });
});
