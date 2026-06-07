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
