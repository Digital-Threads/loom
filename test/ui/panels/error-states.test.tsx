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

// Empty fixture: all layer arrays empty, no errors.
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

describe("edge-case screen states", () => {
  it("empty: isWorkspaceEmpty(empty) === true and Onboarding explains what to do", () => {
    expect(isWorkspaceEmpty(emptyData)).toBe(true);
    const { lastFrame } = render(<OnboardingPanel />);
    const f = lastFrame()!;
    expect(f).toContain("Getting started");
    expect(f).toContain("loom plugin add");
  });

  it("partial: one plugin has data → not considered empty", () => {
    const partial: WorkspaceData = {
      ...emptyData,
      tasks: [{ id: "t1", title: "Demo task", status: "open" }],
    };
    expect(isWorkspaceEmpty(partial)).toBe(false);
  });

  it("plugin error: loadWorkspaceData does not throw, returns a well-formed object with errors[]", async () => {
    // safe() wraps each plugin.load() → a plugin error goes into errors[],
    // rather than crashing the data collection. We pin the contract: the call resolves to an object
    // of the correct shape (errors is an array, layers are arrays), without throwing.
    const data = await loadWorkspaceData();
    expect(Array.isArray(data.errors)).toBe(true);
    expect(Array.isArray(data.subscriptions)).toBe(true);
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(Array.isArray(data.tokens)).toBe(true);
    expect(Array.isArray(data.taskEvents)).toBe(true);
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(typeof data.projectId).toBe("string");
  });

  it("broken registry: readInstalled on a corrupt file does not throw, returns an empty registry", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loom-registry-"));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    writeFileSync(join(dataDir, "plugins.json"), "{ this is not valid JSON ", "utf8");
    const deps: InstallDeps = {
      dataDir,
      run: () => ({ ok: true, stdout: "", stderr: "" }),
    };
    const reg = readInstalled(deps);
    expect(reg).toEqual({ schemaVersion: 1, plugins: {} });
  });
});
