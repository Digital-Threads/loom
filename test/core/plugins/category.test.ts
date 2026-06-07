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

describe("LP1 capabilities — декларация возможностей", () => {
  it("каждый builtin объявляет capabilities-флаги (boolean)", () => {
    for (const p of loomRegistry.list()) {
      expect(p.capabilities).toBeDefined();
      const c = p.capabilities!;
      for (const k of ["install", "data", "settings", "actions"] as const) {
        expect(typeof c[k]).toBe("boolean");
      }
    }
  });

  it("флаги отражают реальную форму плагина", () => {
    const tp = loomRegistry.get("token-pilot")!;
    expect(tp.capabilities!.settings).toBe(true);   // непустая settings.schema
    expect(tp.capabilities!.actions).toBe(false);   // actions: []

    const aimux = loomRegistry.get("aimux")!;
    expect(aimux.capabilities!.actions).toBe(true);  // addSubscription

    // install-рецептов ещё нет (LP2) → install=false у всех трёх
    for (const id of ["aimux", "token-pilot", "task-journal"]) {
      expect(loomRegistry.get(id)!.capabilities!.install).toBe(false);
    }

    // data: у всех трёх есть load() → true
    for (const p of loomRegistry.list()) expect(p.capabilities!.data).toBe(true);
  });
});
