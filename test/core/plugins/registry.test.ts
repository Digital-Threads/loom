import { describe, it, expect } from "vitest";
import { createRegistry } from "../../../src/core/plugins/registry.js";
import type { LoomPlugin } from "../../../src/core/plugins/types.js";

const fake: LoomPlugin = {
  id: "fake",
  title: "Fake",
  tabs: [{ id: "x", title: "X" }],
  load: () => ({}),
};

const other: LoomPlugin = {
  id: "other",
  title: "Other",
  tabs: [{ id: "y", title: "Y" }],
  load: () => ({}),
};

const fakeDup: LoomPlugin = {
  id: "fake",
  title: "Fake Dup",
  tabs: [{ id: "z", title: "Z" }],
  load: () => ({}),
};

describe("registry", () => {
  it("registers and returns the plugins", () => {
    const r = createRegistry([fake]);
    expect(r.list().map((p) => p.id)).toEqual(["fake"]);
    expect(r.get("fake")?.title).toBe("Fake");
  });

  it("register a new id → true and get finds it", () => {
    const r = createRegistry([fake]);
    expect(r.register(other)).toBe(true);
    expect(r.get("other")?.title).toBe("Other");
    expect(r.list().map((p) => p.id)).toEqual(["fake", "other"]);
  });

  it("register a duplicate → false, the original stays", () => {
    const r = createRegistry([fake]);
    expect(r.register(fakeDup)).toBe(false);
    expect(r.get("fake")?.title).toBe("Fake"); // the builtin was not overwritten
  });
});

describe("registry.groupByCategory", () => {
  it("groups plugins by category, no category → \"undefined\" key", () => {
    const a: LoomPlugin = { id: "a", title: "A", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "accounts" };
    const b: LoomPlugin = { id: "b", title: "B", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "efficiency" };
    const c: LoomPlugin = { id: "c", title: "C", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "accounts" };
    const r = createRegistry([a, b, c, fake]); // fake — without a category

    const grouped = r.groupByCategory();
    expect(grouped.get("accounts")?.map((p) => p.id)).toEqual(["a", "c"]);
    expect(grouped.get("efficiency")?.map((p) => p.id)).toEqual(["b"]);
    expect(grouped.get("undefined")?.map((p) => p.id)).toEqual(["fake"]);
  });

  it("order within a group = registration order", () => {
    const r = createRegistry([fake]);
    const x: LoomPlugin = { id: "x2", title: "X2", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "memory" };
    const y: LoomPlugin = { id: "y2", title: "Y2", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "memory" };
    r.register(x);
    r.register(y);
    expect(r.groupByCategory().get("memory")?.map((p) => p.id)).toEqual(["x2", "y2"]);
  });
});

describe("registry capability lookup (D1.2)", () => {
  const exec: LoomPlugin = {
    id: "exec", title: "Exec", tabs: [], load: () => ({}), category: "automation",
    async execute(step) { return { ok: true, id: step.id }; },
    slots: [{ stage: "rd", skill: "writing-plans" }],
  };
  const reviewer: LoomPlugin = {
    id: "rev", title: "Rev", tabs: [], load: () => ({}), category: "quality",
    slots: [{ stage: "review", skill: "code-review" }, { stage: "qa", skill: "canary" }],
  };

  it("layersByCapability('execute') returns only plugins with execute()", () => {
    const r = createRegistry([fake, exec, reviewer]);
    expect(r.layersByCapability("execute").map((p) => p.id)).toEqual(["exec"]);
  });

  it("layersByCapability('slots') returns plugins contributing any slot", () => {
    const r = createRegistry([fake, exec, reviewer]);
    expect(r.layersByCapability("slots").map((p) => p.id).sort()).toEqual(["exec", "rev"]);
  });

  it("slotProviders(stage) returns plugins backing that stage", () => {
    const r = createRegistry([fake, exec, reviewer]);
    expect(r.slotProviders("review").map((p) => p.id)).toEqual(["rev"]);
    expect(r.slotProviders("rd").map((p) => p.id)).toEqual(["exec"]);
    expect(r.slotProviders("nope")).toEqual([]);
  });

  it("D1.3: orchestrator finds the executor via registry and runs it with injected ctx", async () => {
    const events: unknown[] = [];
    const layer: LoomPlugin = {
      id: "auto", title: "Auto", tabs: [], load: () => ({}), category: "automation",
      async execute(step, ctx) {
        ctx.appendEvent?.({ step: step.id });           // uses injected DI surface
        return { ok: true, project: ctx.spine?.projectId };
      },
    };
    const r = createRegistry([fake, layer]);
    const executor = r.layersByCapability("execute")[0];   // discovered, not imported
    expect(executor.id).toBe("auto");
    const res = await executor.execute!(
      { id: "s1" },
      { projectRoot: "/p", spine: { projectId: "p1" }, appendEvent: (e) => events.push(e) },
    );
    expect(res).toMatchObject({ ok: true, project: "p1" });
    expect(events).toEqual([{ step: "s1" }]);              // DI reached the layer
  });
});
