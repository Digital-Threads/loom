import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { redactSecrets } from "../../../../src/core/layers/security/secrets.js";
import { getSandboxBackend, runWithLimits, WorktreeBackend } from "../../../../src/core/layers/security/sandbox-backend.js";
import { secureExecutor } from "../../../../src/core/layers/security/secure-executor.js";
import { configureSecurity, type AuditEvent } from "../../../../src/core/layers/security/config.js";

describe("redactSecrets (L10.3)", () => {
  it("replaces secrets in text, keeping only a redacted preview", () => {
    const out = redactSecrets("key=sk-ant-ABCDEFGHIJKLMNOPQRSTUV done");
    expect(out).not.toContain("ABCDEFGHIJKLMNOPQRSTUV");
    expect(out).toContain("…");
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
  // Capture audit events via the injected sink (the host wires the real bus).
  let captured: AuditEvent[];
  beforeEach(() => { captured = []; configureSecurity({ emit: (_p, e) => captured.push(e) }); });
  afterEach(() => { configureSecurity({ emit: () => {} }); });

  it("redacts secrets in captured output and audits the finding", async () => {
    const leaky = { async run() { return { exitCode: 0, stdout: "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWX ok" }; } };
    const res = await secureExecutor(leaky).run({ ids: { projectId: "psec", taskId: "tj-1" } });
    expect(res.stdout).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(captured.filter((e) => e.type === "audit.secret.found").length).toBeGreaterThan(0);
  });

  it("turns an overrun into a failed result via the limit", async () => {
    const slow = { async run() { return new Promise<{ exitCode: number; stderr?: string }>((r) => setTimeout(() => r({ exitCode: 0 }), 50)); } };
    const res = await secureExecutor(slow, { limits: { timeoutMs: 5 } }).run({ ids: { projectId: "psec" } });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/timeout/);
  });
});
