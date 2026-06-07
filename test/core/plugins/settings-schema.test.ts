import { describe, it, expect } from "vitest";
import { settingsSchema as tpSettingsSchema } from "../../../src/core/plugins/token-pilot/adapter.js";
import { settingsSchema as aimuxSettingsSchema } from "../../../src/core/plugins/aimux/adapter.js";
import { settingsSchema as tjSettingsSchema } from "../../../src/core/plugins/task-journal/adapter.js";
import type { LoomPlugin } from "../../../src/core/plugins/types.js";

describe("settingsSchema адаптеров", () => {
  it("token-pilot отдаёт enum-поле hooks.mode с deny-enhanced", () => {
    const schema = tpSettingsSchema();
    const mode = schema.fields.find((f) => f.key === "hooks.mode");
    expect(mode).toBeDefined();
    expect(mode?.type).toBe("enum");
    expect(mode?.options).toContain("deny-enhanced");
  });

  it("token-pilot: enum-поля имеют непустой options, не-enum — нет", () => {
    const schema = tpSettingsSchema();
    for (const f of schema.fields) {
      if (f.type === "enum") {
        expect(f.options).toBeDefined();
        expect(f.options!.length).toBeGreaterThan(0);
      } else {
        expect(f.options === undefined || f.options.length === 0).toBe(true);
      }
    }
    const threshold = schema.fields.find((f) => f.key === "hooks.denyThreshold");
    expect(threshold?.type).toBe("number");
  });

  it("aimux отдаёт пустую схему", () => {
    expect(aimuxSettingsSchema().fields.length).toBe(0);
  });

  it("task-journal отдаёт пустую схему", () => {
    expect(tjSettingsSchema().fields.length).toBe(0);
  });

  it("LoomPlugin принимает опциональный settings", () => {
    const plugin: LoomPlugin = {
      id: "tp",
      title: "Token Pilot",
      tabs: [{ id: "settings", title: "Settings" }],
      load: () => ({}),
      settings: {
        schema: tpSettingsSchema(),
        read: () => ({}),
        write: () => false,
      },
    };
    expect(plugin.settings!.schema.fields.length).toBeGreaterThan(0);
  });
});
