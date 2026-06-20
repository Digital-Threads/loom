import { describe, it, expect } from "vitest";
import { ensureWorktree, removeWorktree, worktreeBranch, worktreePath, prepareSwarmWorktree, removeSwarmWorktree, swarmWorktreeBranch, swarmWorktreePath } from "../../../../src/core/layers/security/sandbox.js";

// Fake git: records calls; `show-ref --verify` throws unless the branch is in the
// `branches` set (mirrors real git — execFileSync throws on a non-zero exit).
function fakeGit(branches: Iterable<string> = []) {
  const calls: string[][] = [];
  const set = new Set(branches);
  const git = (args: string[]): string => {
    calls.push(args);
    if (args[0] === "show-ref") {
      const name = args[args.length - 1].replace("refs/heads/", "");
      if (!set.has(name)) throw new Error("ref not found");
    }
    return "";
  };
  return { git, calls };
}

describe("ensureWorktree (one worktree per task, idempotent + branch-safe)", () => {
  it("creates the worktree + branch on first use (no leftover branch)", () => {
    const { git, calls } = fakeGit(); // no branches exist
    const wt = ensureWorktree("/repo", "t1", { git, exists: () => false });
    expect(wt).toEqual({ path: worktreePath("t1"), branch: worktreeBranch("t1") });
    expect(calls.some((c) => c.join(" ") === `worktree add -b ${worktreeBranch("t1")} ${worktreePath("t1")}`)).toBe(true);
  });

  it("reuses the existing worktree dir without touching git", () => {
    const { git, calls } = fakeGit();
    const wt = ensureWorktree("/repo", "t1", { git, exists: () => true });
    expect(wt).toEqual({ path: worktreePath("t1"), branch: worktreeBranch("t1") });
    expect(calls).toEqual([]); // reuse → no git
  });

  it("ATTACHES a leftover branch instead of failing on -b (de-wedges a stuck task)", () => {
    // The branch lingers from a prior run but the worktree dir is gone — the bug
    // that wedged a task: `add -b` would fail "branch already exists" every run.
    const { git, calls } = fakeGit([worktreeBranch("t9")]);
    const wt = ensureWorktree("/repo", "t9", { git, exists: () => false });
    expect(wt).toEqual({ path: worktreePath("t9"), branch: worktreeBranch("t9") });
    const add = calls.find((c) => c[0] === "worktree" && c[1] === "add");
    expect(add).toEqual(["worktree", "add", worktreePath("t9"), worktreeBranch("t9")]); // attach, no -b
  });

  it("symlinks the repo's node_modules into a fresh worktree (deps without install)", () => {
    const links: string[][] = [];
    ensureWorktree("/repo", "t2", {
      git: fakeGit().git,
      exists: (p) => p === "/repo/node_modules" || p === "/repo/web/node_modules",
      link: (src, dst) => { links.push([src, dst]); },
    });
    expect(links.map((l) => l[0])).toEqual(["/repo/node_modules", "/repo/web/node_modules"]);
    expect(links[0][1]).toBe(`${worktreePath("t2")}/node_modules`);
  });

  it("removeWorktree drops the worktree AND deletes the branch (no orphan to wedge a re-run)", () => {
    const { git, calls } = fakeGit([worktreeBranch("t3")]);
    removeWorktree("/repo", "t3", { git });
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(true);
    expect(calls.some((c) => c[0] === "branch" && c[1] === "-D" && c[2] === worktreeBranch("t3"))).toBe(true);
  });
});

describe("impl-swarm worktrees (one per attempt)", () => {
  it("each slot gets a distinct path + branch under the task", () => {
    expect(swarmWorktreeBranch("t1", 0)).toBe("loom/t1/sw0");
    expect(swarmWorktreeBranch("t1", 2)).toBe("loom/t1/sw2");
    expect(swarmWorktreePath("t1", 0)).toContain("worktrees/t1/sw0");
    expect(swarmWorktreePath("t1", 0)).not.toBe(swarmWorktreePath("t1", 1)); // isolated
    expect(swarmWorktreePath("t1", 0)).not.toBe(worktreePath("t1")); // separate from the task worktree
  });

  it("prepareSwarmWorktree creates the slot's worktree+branch (attach if it lingers)", () => {
    const { git, calls } = fakeGit(); // no branch yet
    const wt = prepareSwarmWorktree("/repo", "t7", 1, { git, exists: () => false });
    expect(wt).toEqual({ path: swarmWorktreePath("t7", 1), branch: swarmWorktreeBranch("t7", 1) });
    const add = calls.find((c) => c[0] === "worktree" && c[1] === "add")!;
    expect(add).toEqual(["worktree", "add", "-b", swarmWorktreeBranch("t7", 1), swarmWorktreePath("t7", 1)]);
  });

  it("removeSwarmWorktree drops the loser's worktree + branch (cleanup)", () => {
    const { git, calls } = fakeGit([swarmWorktreeBranch("t7", 2)]);
    removeSwarmWorktree("/repo", "t7", 2, { git });
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "remove" && c[2] === "--force")).toBe(true);
    expect(calls.some((c) => c[0] === "branch" && c[1] === "-D" && c[2] === swarmWorktreeBranch("t7", 2))).toBe(true);
  });
});
