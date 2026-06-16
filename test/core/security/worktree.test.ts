import { describe, it, expect } from "vitest";
import { ensureWorktree, worktreeBranch, worktreePath } from "../../../src/core/security/sandbox.js";

describe("ensureWorktree (one worktree per task, idempotent)", () => {
  it("creates the worktree on first use", () => {
    const calls: string[][] = [];
    const wt = ensureWorktree("/repo", "t1", {
      git: (args) => { calls.push(args); return ""; },
      exists: () => false, // not created yet
    });
    expect(wt).toEqual({ path: worktreePath("t1"), branch: worktreeBranch("t1") });
    expect(calls[0]).toEqual(["worktree", "add", "-b", worktreeBranch("t1"), worktreePath("t1")]);
  });

  it("reuses the existing worktree without touching git", () => {
    const calls: string[][] = [];
    const wt = ensureWorktree("/repo", "t1", {
      git: (args) => { calls.push(args); return ""; },
      exists: () => true, // already there
    });
    expect(wt).toEqual({ path: worktreePath("t1"), branch: worktreeBranch("t1") });
    expect(calls).toEqual([]); // no git invoked on reuse
  });

  it("symlinks the repo's node_modules into a fresh worktree (deps without install)", () => {
    const links: string[][] = [];
    ensureWorktree("/repo", "t2", {
      git: () => "",
      // worktree itself absent; the repo's node_modules dirs present.
      exists: (p) => p === "/repo/node_modules" || p === "/repo/web/node_modules",
      link: (src, dst) => { links.push([src, dst]); },
    });
    expect(links.map((l) => l[0])).toEqual(["/repo/node_modules", "/repo/web/node_modules"]);
    expect(links[0][1]).toBe(`${worktreePath("t2")}/node_modules`);
  });
});
