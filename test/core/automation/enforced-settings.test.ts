import { describe, it, expect } from "vitest";
import { ENFORCED_SETTINGS, enforcedSettingsPath } from "../../../src/core/automation/enforced-settings.js";
import { readFileSync } from "node:fs";

describe("enforced settings", () => {
  it("forces token-pilot hooks on the raw read/search/bash tools", () => {
    const matchers = ENFORCED_SETTINGS.hooks.PreToolUse.map((h) => h.matcher);
    expect(matchers).toEqual(expect.arrayContaining(["Read", "Grep", "Bash", "Edit", "Task"]));
    const cmds = ENFORCED_SETTINGS.hooks.PreToolUse.flatMap((m) => m.hooks.map((h) => h.command));
    expect(cmds.every((c) => c.startsWith("token-pilot "))).toBe(true);
  });

  it("reinforces per-turn via SessionStart + UserPromptSubmit", () => {
    expect(ENFORCED_SETTINGS.hooks.SessionStart[0].hooks[0].command).toContain("hook-session-start");
    expect(ENFORCED_SETTINGS.hooks.UserPromptSubmit[0].hooks[0].command).toContain("hook-user-prompt");
  });

  it("writes the settings file and returns its path", () => {
    const p = enforcedSettingsPath();
    expect(p).toMatch(/enforced-settings\.json$/);
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(written.hooks.PreToolUse.length).toBeGreaterThan(0);
  });
});
