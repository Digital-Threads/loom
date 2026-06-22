import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ENFORCED_SETTINGS, enforcedSettingsPath, enforceFlags, tokenPilotOnPath } from "../../../src/core/automation/enforced-settings.js";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

  it("augments the written Bash hook with the command-policy script (loom-secpol)", () => {
    const written = JSON.parse(readFileSync(enforcedSettingsPath(), "utf8"));
    const bash = written.hooks.PreToolUse.find((h: { matcher: string }) => h.matcher === "Bash");
    const node = bash.hooks.find((h: { command: string }) => /command-policy\.cjs$/.test(h.command));
    expect(node).toBeDefined(); // the command allow/deny enforcement hook is wired
    const scriptPath = node.command.replace(/^node /, "");
    expect(existsSync(scriptPath)).toBe(true);
    // the script bakes the DEFAULT_DENY floor (so dangerous commands are blocked
    // even with no user policy / a missing policy file).
    const body = readFileSync(scriptPath, "utf8");
    expect(body).toContain("rm"); // a DEFAULT_DENY source (rm -rf /) is baked in
    expect(body).toContain("permissionDecision");
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

describe("command-policy hook audit trail (loom-block-audit)", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "loom-hook-audit-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  function runHook(command: string, env: Record<string, string> = {}) {
    // Ensure the hook script is written to disk
    enforcedSettingsPath();
    const hookPath = join(homedir(), ".loom", "hooks", "command-policy.cjs");
    // Strip XDG_DATA_HOME so the hook's data dir is deterministically HOME/.loom
    // unless a test sets it explicitly (the XDG-redirect case below).
    const base = { ...process.env, HOME: tmpDir };
    delete base.XDG_DATA_HOME;
    return spawnSync("node", [hookPath], {
      input: JSON.stringify({ tool_input: { command } }),
      env: { ...base, ...env },
      encoding: "utf8",
    });
  }

  it("writes a JSONL audit entry when a command is blocked and LOOM_TASK_ID is set", () => {
    const result = runHook("rm -rf /", { LOOM_TASK_ID: "t-audit1", LOOM_PROJECT_ID: "proj-test" });
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");

    const auditFile = join(tmpDir, ".loom", "audit", "t-audit1.jsonl");
    expect(existsSync(auditFile)).toBe(true);
    const entry = JSON.parse(readFileSync(auditFile, "utf8").trim());
    expect(entry.taskId).toBe("t-audit1");
    expect(entry.projectId).toBe("proj-test");
    expect(entry.command).toBe("rm -rf /");
    expect(typeof entry.ts).toBe("number");
    expect(typeof entry.reason).toBe("string");
  });

  it("does NOT write an audit entry when the command is allowed", () => {
    const result = runHook("echo hello", { LOOM_TASK_ID: "t-audit2" });
    expect(result.stdout).toBe("");
    const auditFile = join(tmpDir, ".loom", "audit", "t-audit2.jsonl");
    expect(existsSync(auditFile)).toBe(false);
  });

  it("does NOT write an audit entry when LOOM_TASK_ID is absent", () => {
    const result = runHook("rm -rf /");
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    const auditDir = join(tmpDir, ".loom", "audit");
    expect(existsSync(auditDir)).toBe(false);
  });

  it("honours XDG_DATA_HOME so writer + reader (loomDataDir) agree (loom-block-audit)", () => {
    const xdg = join(tmpDir, "xdgdata");
    runHook("rm -rf /", { LOOM_TASK_ID: "t-xdg", XDG_DATA_HOME: xdg });
    // The hook writes under $XDG_DATA_HOME/loom/audit — the SAME place loomDataDir()
    // (and thus the reader) resolves to when XDG_DATA_HOME is set; NOT ~/.loom.
    expect(existsSync(join(xdg, "loom", "audit", "t-xdg.jsonl"))).toBe(true);
    expect(existsSync(join(tmpDir, ".loom", "audit", "t-xdg.jsonl"))).toBe(false);
  });
});
