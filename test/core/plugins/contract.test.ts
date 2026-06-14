import { describe, it, expect } from "vitest";
import { loomRegistry } from "../../../src/core/plugins/index.js";
import type {
  LoomPlugin,
  LoomContext,
  LoomCategory,
  SlotContribution,
  CapabilityStep,
  CapabilityResult,
} from "../../../src/core/plugins/contract.js";

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

describe("plugin contract — capability facet (D1.1)", () => {
  it("a behavior layer may declare execute / slots / costHint / models", async () => {
    const slot: SlotContribution = { stage: "review", skill: "code-review", passId: "normal" };
    const layer: LoomPlugin = {
      id: "demo-automation",
      title: "Demo Automation",
      category: "automation",
      capabilities: { install: false, data: false, settings: false, actions: false, execute: true, slots: true },
      tabs: [],
      load: () => ({}),
      slots: [slot],
      models: ["claude-haiku-4-5"],
      costHint: (step: CapabilityStep) => ({ estTokens: step.id.length }),
      async execute(step: CapabilityStep, ctx: LoomContext): Promise<CapabilityResult> {
        return { ok: true, stepId: step.id, root: ctx.projectRoot };
      },
    };
    const res = await layer.execute!({ id: "s1" }, { projectRoot: "/p" });
    expect(res.ok).toBe(true);
    expect(layer.slots?.[0].stage).toBe("review");
    expect(layer.costHint!({ id: "abcd" }).estTokens).toBe(4);
  });

  it("LoomContext carries optional DI surfaces (spine/appendEvent/logger)", () => {
    const events: unknown[] = [];
    const ctx: LoomContext = {
      projectRoot: "/p",
      spine: { projectId: "p1", taskId: "tj-1", workflowId: "wf1" },
      appendEvent: (e) => events.push(e),
      logger: { info: () => {} },
    };
    ctx.appendEvent!({ type: "x" });
    expect(events).toHaveLength(1);
    expect(ctx.spine?.projectId).toBe("p1");
  });

  it("security and extensibility are valid LoomCategory values", () => {
    const cats: LoomCategory[] = ["security", "extensibility"];
    expect(cats).toEqual(["security", "extensibility"]);
  });

  it("a display plugin without the capability facet is still valid (back-compat)", () => {
    const display: LoomPlugin = { id: "d", title: "D", tabs: [{ id: "t", title: "T" }], load: () => ({}) };
    expect(display.execute).toBeUndefined();
    expect(display.slots).toBeUndefined();
  });
});
