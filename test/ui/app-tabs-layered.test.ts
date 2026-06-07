import { describe, it, expect } from "vitest";
import { buildPluginTabs } from "../../src/core/dashboard/layers.js";

const plugins = [
  { id: "task-journal", category: "memory", tabs: [{ id: "tasks", title: "Задачи" }] },
  { id: "token-pilot", category: "efficiency", tabs: [{ id: "tok", title: "Токены" }] },
  { id: "aimux", category: "accounts", tabs: [{ id: "subs", title: "Подписки" }, { id: "sess", title: "Сессии" }] },
] as any[];

describe("buildPluginTabs (layered)", () => {
  it("orders tabs by layer regardless of registry order", () => {
    expect(buildPluginTabs(plugins).map((t) => t.title))
      .toEqual(["Подписки", "Сессии", "Токены", "Задачи"]);
  });
});
