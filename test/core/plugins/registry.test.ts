import { describe, it, expect } from "vitest";
import { createRegistry } from "../../../src/core/plugins/registry.js";
import type { LoomPlugin } from "../../../src/core/plugins/types.js";

const fake: LoomPlugin = {
  id: "fake",
  title: "Fake",
  tabs: [{ id: "x", title: "X" }],
  load: () => ({}),
};

describe("registry", () => {
  it("регистрирует и отдаёт плагины", () => {
    const r = createRegistry([fake]);
    expect(r.list().map((p) => p.id)).toEqual(["fake"]);
    expect(r.get("fake")?.title).toBe("Fake");
  });
});
