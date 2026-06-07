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
  it("регистрирует и отдаёт плагины", () => {
    const r = createRegistry([fake]);
    expect(r.list().map((p) => p.id)).toEqual(["fake"]);
    expect(r.get("fake")?.title).toBe("Fake");
  });

  it("register нового id → true и get его находит", () => {
    const r = createRegistry([fake]);
    expect(r.register(other)).toBe(true);
    expect(r.get("other")?.title).toBe("Other");
    expect(r.list().map((p) => p.id)).toEqual(["fake", "other"]);
  });

  it("register дубля → false, прежний на месте", () => {
    const r = createRegistry([fake]);
    expect(r.register(fakeDup)).toBe(false);
    expect(r.get("fake")?.title).toBe("Fake"); // builtin не перезаписан
  });
});

describe("registry.groupByCategory", () => {
  it("группирует плагины по category, без category → ключ \"undefined\"", () => {
    const a: LoomPlugin = { id: "a", title: "A", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "accounts" };
    const b: LoomPlugin = { id: "b", title: "B", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "efficiency" };
    const c: LoomPlugin = { id: "c", title: "C", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "accounts" };
    const r = createRegistry([a, b, c, fake]); // fake — без category

    const grouped = r.groupByCategory();
    expect(grouped.get("accounts")?.map((p) => p.id)).toEqual(["a", "c"]);
    expect(grouped.get("efficiency")?.map((p) => p.id)).toEqual(["b"]);
    expect(grouped.get("undefined")?.map((p) => p.id)).toEqual(["fake"]);
  });

  it("порядок внутри группы = порядок регистрации", () => {
    const r = createRegistry([fake]);
    const x: LoomPlugin = { id: "x2", title: "X2", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "memory" };
    const y: LoomPlugin = { id: "y2", title: "Y2", tabs: [{ id: "t", title: "T" }], load: () => ({}), category: "memory" };
    r.register(x);
    r.register(y);
    expect(r.groupByCategory().get("memory")?.map((p) => p.id)).toEqual(["x2", "y2"]);
  });
});
