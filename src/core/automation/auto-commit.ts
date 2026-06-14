// After the impl stage runs in a sandbox worktree, the agent's file edits are
// uncommitted. The orchestrator commits them so the PR stage has content to
// push. Git runner injected for testability; a no-change worktree commits
// nothing (returns committed:false) rather than erroring.

import { execFileSync } from "node:child_process";

export type GitSh = (args: string[], cwd: string) => { code: number; stdout: string };

const defaultGit: GitSh = (args, cwd) => {
  try {
    const stdout = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "" };
  }
};

/** Stage and commit all changes in a worktree. Returns committed:false when the
 *  tree is clean (nothing to commit). */
export function commitWorktree(cwd: string, message: string, git: GitSh = defaultGit): { committed: boolean } {
  git(["add", "-A"], cwd);
  const status = git(["status", "--porcelain"], cwd);
  if (!status.stdout.trim()) return { committed: false };
  const res = git(["commit", "-m", message], cwd);
  return { committed: res.code === 0 };
}
