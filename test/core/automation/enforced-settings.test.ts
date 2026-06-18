import { describe, it, expect } from "vitest";
import { ENFORCED_SETTINGS, enforcedSettingsPath, enforceFlags, tokenPilotOnPath } from "../../../src/core/automation/enforced-settings.js";
import { readFileSync, existsSync } from "node:fs";
import type { CmdRunner } from "../../../src/core/install/types.js";

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

  it("augments the written Bash hook with the deny-raw-search script", () => {
    const written = JSON.parse(readFileSync(enforcedSettingsPath(), "utf8"));
    const bash = written.hooks.PreToolUse.find((h: { matcher: string }) => h.matcher === "Bash");
    const node = bash.hooks.find((h: { command: string }) => /deny-raw-search\.mjs$/.test(h.command));
    expect(node).toBeDefined(); // the recursive-grep/find deny hook is wired
    expect(existsSync(node.command.replace(/^node /, ""))).toBe(true); // and the script exists on disk
  });

  it("enforceFlags() returns the --settings flag pointing at the written file", () => {
    expect(enforceFlags()).toEqual(["--settings", enforcedSettingsPath()]);
  });

  it("tokenPilotOnPath() reflects the which/where probe result", () => {
    const found: CmdRunner = () => ({ ok: true, stdout: "/usr/bin/token-pilot", stderr: "" });
    const missing: CmdRunner = () => ({ ok: false, stdout: "", stderr: "not found" });
    expect(tokenPilotOnPath(found)).toBe(true);
    expect(tokenPilotOnPath(missing)).toBe(false);
  });

  it("tokenPilotOnPath() probes specifically for token-pilot", () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const spy: CmdRunner = (cmd, args) => { calls.push({ cmd, args }); return { ok: true, stdout: "", stderr: "" }; };
    tokenPilotOnPath(spy, "linux");
    expect(calls[0].cmd).toBe("which");
    expect(calls[0].args).toEqual(["token-pilot"]);
  });
});
