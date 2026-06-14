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
});
