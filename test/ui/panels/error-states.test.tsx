import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OnboardingPanel } from "../../../src/ui/panels/OnboardingPanel.js";
import { isWorkspaceEmpty, loadWorkspaceData, type WorkspaceData } from "../../../src/core/data/loader.js";
import { readInstalled } from "../../../src/core/install/registry-file.js";
import type { InstallDeps } from "../../../src/core/install/types.js";

// Пустая фикстура: все слои-массивы пусты, ошибок нет.
const emptyData: WorkspaceData = {
  subscriptions: [],
  sessions: [],
  health: [],
  tokens: [],
  tokenEvents: [],
  taskEvents: [],
  tasks: [],
  errors: [],
  projectId: "test",
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("краевые состояния экранов", () => {
  it("пустое: isWorkspaceEmpty(empty) === true и Onboarding объясняет, что делать", () => {
    expect(isWorkspaceEmpty(emptyData)).toBe(true);
    const { lastFrame } = render(<OnboardingPanel />);
    const f = lastFrame()!;
    expect(f).toContain("Getting started");
    expect(f).toContain("loom plugin add");
  });

  it("частичное: данные есть у одного плагина → не считается пустым", () => {
    const partial: WorkspaceData = {
      ...emptyData,
      tasks: [{ id: "t1", title: "Демо-задача", status: "open" }],
    };
    expect(isWorkspaceEmpty(partial)).toBe(false);
  });

  it("ошибка плагина: loadWorkspaceData не бросает, а отдаёт корректную форму с errors[]", async () => {
    // safe() оборачивает каждый plugin.load() → ошибка плагина уходит в errors[],
    // а не роняет сбор данных. Фиксируем контракт: вызов завершается объектом
    // правильной формы (errors — массив, слои — массивы), без throw.
    const data = await loadWorkspaceData();
    expect(Array.isArray(data.errors)).toBe(true);
    expect(Array.isArray(data.subscriptions)).toBe(true);
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(Array.isArray(data.tokens)).toBe(true);
    expect(Array.isArray(data.taskEvents)).toBe(true);
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(typeof data.projectId).toBe("string");
  });

  it("битый реестр: readInstalled на повреждённом файле не бросает, а даёт пустой реестр", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loom-registry-"));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    writeFileSync(join(dataDir, "plugins.json"), "{ это не валидный JSON ", "utf8");
    const deps: InstallDeps = {
      dataDir,
      run: () => ({ ok: true, stdout: "", stderr: "" }),
    };
    const reg = readInstalled(deps);
    expect(reg).toEqual({ schemaVersion: 1, plugins: {} });
  });
});
