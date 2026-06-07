import { describe, it, expect } from "vitest";
import { loomRegistry } from "../../../src/core/plugins/index.js";
import type { LoomCategory } from "../../../src/core/plugins/types.js";

const EXPECTED: Record<string, LoomCategory> = {
  aimux: "accounts",
  "token-pilot": "efficiency",
  "task-journal": "memory",
};

describe("LP1 category — слой плагина", () => {
  it("каждый builtin объявляет ожидаемую category", () => {
    for (const [id, cat] of Object.entries(EXPECTED)) {
      expect(loomRegistry.get(id)?.category).toBe(cat);
    }
  });

  it("category — один из 8 допустимых слоёв", () => {
    const allowed = [
      "accounts", "efficiency", "memory", "learning",
      "knowledge", "quality", "automation", "observability",
    ];
    for (const p of loomRegistry.list()) {
      if (p.category !== undefined) expect(allowed).toContain(p.category);
    }
  });
});
