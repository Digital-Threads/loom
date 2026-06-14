import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "../../../src/core/security/secrets.js";
import { evaluateCommand, pathEscapesJail } from "../../../src/core/security/mode.js";
import { getSandboxBackend, runWithLimits, WorktreeBackend } from "../../../src/core/security/sandbox-backend.js";
import { secureExecutor } from "../../../src/core/security/secure-executor.js";
import { loadLoomEvents } from "../../../src/core/spine/event-bus.js";
import type { StepExecutor } from "../../../src/core/automation/exec-loop.js";

describe("redactSecrets (L10.3)", () => {
  it("replaces secrets in text, keeping only a redacted preview", () => {
    const out = redactSecrets("key=sk-ant-ABCDEFGHIJKLMNOPQRSTUV done");
    expect(out).not.toContain("ABCDEFGHIJKLMNOPQRSTUV");
    expect(out).toContain("…");
  });
});

describe("command policy mode + path-jail (L10.2)", () => {
  it("soft warns but allows; enforce blocks a dangerous command", () => {
    const cmd = "rm -rf /";
    expect(evaluateCommand(cmd, { mode: "soft" })).toMatchObject({ ok: true, warned: true });
    expect(evaluateCommand(cmd, { mode: "enforce" })).toMatchObject({ ok: false, blocked: true });
  });
  it("path-jail flags parent traversal under a sandbox root", () => {
    expect(pathEscapesJail("cat ../../etc/passwd")).toBe(true);
    expect(pathEscapesJail("cat ./local")).toBe(false);
    expect(evaluateCommand("cat ../secret", { mode: "enforce", sandboxRoot: "/wt" }).blocked).toBe(true);
  });
  it("a clean command passes", () => {
    expect(evaluateCommand("npm test", { mode: "enforce" })).toEqual({ ok: true, blocked: false, warned: false });
  });
});

describe("sandbox backend (L10.1)", () => {
  it("default backend is the worktree backend; docker is a bookmark (throws)", () => {
    expect(getSandboxBackend()).toBe(WorktreeBackend);
    expect(() => getSandboxBackend("docker")).toThrow(/not implemented/);
  });
  it("runWithLimits passes through under budget and times out over it", async () => {
    expect(await runWithLimits(async () => 42, { timeoutMs: 1000 })).toBe(42);
    await expect(
      runWithLimits(() => new Promise((r) => setTimeout(() => r(1), 50)), { timeoutMs: 5 }),
    ).rejects.toThrow(/timeout/);
  });
});

describe("secureExecutor (L10.5)", () => {
  let prevXdg: string | undefined;
  let dir: string;
  beforeEach(() => {
    prevXdg = process.env.XDG_DATA_HOME;
    dir = mkdtempSync(join(tmpdir(), "loom-sec-"));
    process.env.XDG_DATA_HOME = dir;
  });
  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  it("redacts secrets in captured output and audits the finding", async () => {
    const leaky: StepExecutor = {
      async run() {
        return { exitCode: 0, stdout: "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWX ok" };
      },
    };
    const res = await secureExecutor(leaky).run({
      taskId: "t", step: { id: "s" } as never, ids: { projectId: "psec", taskId: "tj-1" },
    });
    expect(res.stdout).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWX");
    const audits = loadLoomEvents("psec").filter((e) => e.type === "audit.secret.found");
    expect(audits.length).toBeGreaterThan(0);
  });

  it("turns an overrun into a failed result via the limit", async () => {
    const slow: StepExecutor = { async run() { return new Promise((r) => setTimeout(() => r({ exitCode: 0 }), 50)); } };
    const res = await secureExecutor(slow, { limits: { timeoutMs: 5 } }).run({
      taskId: "t", step: { id: "s" } as never, ids: { projectId: "psec" },
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/timeout/);
  });
});
