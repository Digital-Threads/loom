import { describe, it, expect } from "vitest";
import { commitWorktree, type GitSh } from "../../../src/core/automation/auto-commit.js";

describe("commitWorktree", () => {
  it("stages and commits when the tree is dirty", () => {
    const calls: string[][] = [];
    const git: GitSh = (args) => {
      calls.push(args);
      if (args[0] === "status") return { code: 0, stdout: " M greet.js\n" };
      return { code: 0, stdout: "" };
    };
    expect(commitWorktree("/wt", "loom: task", git)).toEqual({ committed: true });
    expect(calls).toEqual([["add", "-A"], ["status", "--porcelain"], ["commit", "-m", "loom: task"]]);
  });

  it("commits nothing when the tree is clean", () => {
    const calls: string[][] = [];
    const git: GitSh = (args) => {
      calls.push(args);
      return { code: 0, stdout: "" };
    };
    expect(commitWorktree("/wt", "loom: task", git)).toEqual({ committed: false });
    expect(calls).toEqual([["add", "-A"], ["status", "--porcelain"]]);
  });
});
