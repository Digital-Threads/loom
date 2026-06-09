import { describe, it, expect } from "vitest";
import { loomRegistry } from "../../../src/core/plugins/index.js";
import type { LoomCategory } from "../../../src/core/plugins/types.js";

const EXPECTED: Record<string, LoomCategory> = {
  aimux: "accounts",
  "token-pilot": "efficiency",
  "task-journal": "memory",
};

describe("LP1 category — plugin layer", () => {
  it("every builtin declares the expected category", () => {
    for (const [id, cat] of Object.entries(EXPECTED)) {
      expect(loomRegistry.get(id)?.category).toBe(cat);
    }
  });

  it("category — one of the 8 allowed layers", () => {
    const allowed = [
      "accounts", "efficiency", "memory", "learning",
      "knowledge", "quality", "automation", "observability",
    ];
    for (const p of loomRegistry.list()) {
      if (p.category !== undefined) expect(allowed).toContain(p.category);
    }
  });
});

describe("LP1 capabilities — capability declaration", () => {
  it("every builtin declares capability flags (boolean)", () => {
    for (const p of loomRegistry.list()) {
      expect(p.capabilities).toBeDefined();
      const c = p.capabilities!;
      for (const k of ["install", "data", "settings", "actions"] as const) {
        expect(typeof c[k]).toBe("boolean");
      }
    }
  });

  it("the flags reflect the actual shape of the plugin", () => {
    const tp = loomRegistry.get("token-pilot")!;
    expect(tp.capabilities!.settings).toBe(true);   // non-empty settings.schema
    expect(tp.capabilities!.actions).toBe(false);   // actions: []

    const aimux = loomRegistry.get("aimux")!;
    expect(aimux.capabilities!.actions).toBe(true);  // addSubscription

    // no install recipes yet (LP2) → install=false for all three
    for (const id of ["aimux", "token-pilot", "task-journal"]) {
      expect(loomRegistry.get(id)!.capabilities!.install).toBe(false);
    }

    // data: all three have load() → true
    for (const p of loomRegistry.list()) expect(p.capabilities!.data).toBe(true);
  });
});
