import { describe, it, expect } from "vitest";
import { CATALOG_ENTRIES } from "../../../src/core/catalog/catalog-data.js";
import { resolveEntries } from "../../../src/core/catalog/catalog.js";

describe("catalog-data", () => {
  it("статичная запись = только id/title/case (category/recipe НЕ дублируются)", () => {
    const ids = CATALOG_ENTRIES.map((e) => e.id).sort();
    expect(ids).toEqual(["aimux", "task-journal", "token-pilot"]);
    for (const e of CATALOG_ENTRIES) {
      expect(e.case.length).toBeGreaterThan(0);
      expect("category" in e).toBe(false);
      expect("recipe" in e).toBe(false);
    }
  });
  it("resolveEntries подмешивает category (реестр LP1) + recipe (манифест LP2)", () => {
    const resolved = resolveEntries();
    for (const e of resolved) {
      expect(e.category).toBeTruthy();
      expect(e.recipe).toBeDefined();
    }
  });
  it("категории соответствуют слоям vision §5 (через реестр, не хардкод)", () => {
    const byId = Object.fromEntries(resolveEntries().map((e) => [e.id, e.category]));
    expect(byId["aimux"]).toBe("accounts");
    expect(byId["token-pilot"]).toBe("efficiency");
    expect(byId["task-journal"]).toBe("memory");
  });
});
