import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { commitWorktree, rebaseWorktreeOnBase, syncWorktreeToRemoteBase, type GitSh } from "../../../src/core/automation/auto-commit.js";

describe("commitWorktree", () => {
  it("stages and commits when the tree is dirty", () => {
    const calls: string[][] = [];
    const git: GitSh = (args) => {
      calls.push(args);
      if (args[0] === "status") return { code: 0, stdout: " M greet.js\n" };
      return { code: 0, stdout: "" }; // rev-parse → "" → no exclude file work
    };
    expect(commitWorktree("/wt", "loom: task", git)).toEqual({ committed: true });
    expect(calls).toEqual([
      ["rev-parse", "--git-path", "info/exclude"],
      ["add", "-A"],
      ["status", "--porcelain"],
      ["commit", "-m", "loom: task"],
    ]);
  });

  it("commits nothing when the tree is clean", () => {
    const calls: string[][] = [];
    const git: GitSh = (args) => {
      calls.push(args);
      return { code: 0, stdout: "" };
    };
    expect(commitWorktree("/wt", "loom: task", git)).toEqual({ committed: false });
    expect(calls).toEqual([
      ["rev-parse", "--git-path", "info/exclude"],
      ["add", "-A"],
      ["status", "--porcelain"],
    ]);
  });
});

describe("commitWorktree — excludes session/tool artifacts (real git)", () => {
  let dir: string;
  const g = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loom-commit-"));
    g(["init", "-q"]);
    g(["config", "user.email", "t@t"]);
    g(["config", "user.name", "t"]);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("commits the task's files but not .claude / .token-pilot artifacts (loom-isd)", () => {
    writeFileSync(join(dir, "index.js"), "export const x = 1;\n");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude/settings.json"), "{}\n");
    mkdirSync(join(dir, ".token-pilot"), { recursive: true });
    writeFileSync(join(dir, ".token-pilot/hook-events.jsonl"), "{}\n");
    writeFileSync(join(dir, ".token-pilot-fingerprint.json"), "{}\n");

    expect(commitWorktree(dir, "loom: add x").committed).toBe(true);
    const tracked = g(["ls-files"]).split("\n").filter(Boolean);
    expect(tracked).toContain("index.js");
    expect(tracked.some((f) => f.startsWith(".claude/"))).toBe(false);
    expect(tracked.some((f) => f.startsWith(".token-pilot"))).toBe(false);
  });
});

describe("rebaseWorktreeOnBase (real git)", () => {
  let dir: string;
  const g = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loom-rebase-"));
    g(["init", "-q"]); g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("rebases the task branch onto a base that moved during the run (loom-705a)", () => {
    writeFileSync(join(dir, "f1"), "1\n"); g(["add", "-A"]); g(["commit", "-qm", "f1"]); g(["branch", "-M", "master"]);
    g(["checkout", "-qb", "feat"]); writeFileSync(join(dir, "a.js"), "a\n"); g(["add", "-A"]); g(["commit", "-qm", "add a"]);
    g(["checkout", "-q", "master"]); writeFileSync(join(dir, "b.js"), "b\n"); g(["add", "-A"]); g(["commit", "-qm", "add b"]);
    g(["checkout", "-q", "feat"]);
    expect(rebaseWorktreeOnBase(dir, ["nope", "master", "main"])).toEqual({ base: "master", conflict: false });
    expect(g(["ls-files"]).split("\n")).toContain("b.js"); // master's commit now under feat
  });

  it("aborts and reports a conflict, leaving the branch untouched", () => {
    writeFileSync(join(dir, "c"), "base\n"); g(["add", "-A"]); g(["commit", "-qm", "base"]); g(["branch", "-M", "master"]);
    g(["checkout", "-qb", "feat"]); writeFileSync(join(dir, "c"), "feat\n"); g(["add", "-A"]); g(["commit", "-qm", "feat c"]);
    g(["checkout", "-q", "master"]); writeFileSync(join(dir, "c"), "master\n"); g(["add", "-A"]); g(["commit", "-qm", "master c"]);
    g(["checkout", "-q", "feat"]);
    expect(rebaseWorktreeOnBase(dir, ["master"])).toEqual({ base: "master", conflict: true });
    expect(readFileSync(join(dir, "c"), "utf8")).toBe("feat\n"); // rebase aborted, feat's content intact
  });

  it("no-ops when no base candidate exists", () => {
    writeFileSync(join(dir, "x"), "1\n"); g(["add", "-A"]); g(["commit", "-qm", "x"]);
    expect(rebaseWorktreeOnBase(dir, ["nope", "nada"])).toEqual({ base: null, conflict: false });
  });
});

describe("syncWorktreeToRemoteBase (loom-bovz)", () => {
  it("fetches origin, then rebases onto the LIVE remote base before the local one", () => {
    const calls: string[][] = [];
    const git: GitSh = (args) => {
      calls.push(args);
      // origin/master exists (remote tracking ref refreshed by the fetch); the
      // stale local master also exists but must not be the one we rebase onto.
      if (args[0] === "rev-parse") return { code: args.includes("origin/master") ? 0 : 1, stdout: "" };
      return { code: 0, stdout: "" };
    };
    expect(syncWorktreeToRemoteBase("/wt", [null, "master", "main"], git)).toEqual({ base: "origin/master", conflict: false });
    expect(calls[0]).toEqual(["fetch", "origin"]); // fetch first, so origin/* is live
    expect(calls[1]).toEqual(["rev-parse", "--verify", "--quiet", "origin/master"]); // remote preferred over local
    expect(calls).toContainEqual(["rebase", "origin/master"]);
  });

  it("falls back to the local base when there's no remote tracking ref (offline / no origin)", () => {
    const git: GitSh = (args) => {
      if (args[0] === "rev-parse") {
        const ref = args[args.length - 1];
        return { code: ref === "master" ? 0 : 1, stdout: "" }; // only the local master resolves
      }
      return { code: 0, stdout: "" };
    };
    expect(syncWorktreeToRemoteBase("/wt", ["master", "main"], git)).toEqual({ base: "master", conflict: false });
  });
});
