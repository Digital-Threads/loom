// Sandbox — run agent work in an isolated git worktree so the autopilot never
// mutates the user's working tree directly. Thin wrapper over `git worktree`;
// the git runner is injected so it's testable without a real repo.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { loomDataDir } from "../paths.js";

export type GitRunner = (args: string[], cwd: string) => string;

const defaultGit: GitRunner = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

export interface Worktree {
  path: string;
  branch: string;
}

export function worktreeBranch(taskId: string): string {
  return `loom/${taskId}`;
}

export function worktreePath(taskId: string): string {
  return join(loomDataDir(), "worktrees", taskId);
}

export interface SandboxOptions {
  /** Base ref to branch from (default: current HEAD). */
  base?: string;
  git?: GitRunner;
}

/** Create an isolated worktree + branch for a task. Returns its path/branch. */
export function prepareWorktree(
  repoRoot: string,
  taskId: string,
  opts: SandboxOptions = {},
): Worktree {
  const git = opts.git ?? defaultGit;
  const path = worktreePath(taskId);
  const branch = worktreeBranch(taskId);
  const args = ["worktree", "add", "-b", branch, path];
  if (opts.base) args.push(opts.base);
  git(args, repoRoot);
  return { path, branch };
}

/** Remove a task's worktree (best-effort; force drops uncommitted changes). */
export function removeWorktree(
  repoRoot: string,
  taskId: string,
  opts: SandboxOptions = {},
): void {
  const git = opts.git ?? defaultGit;
  try {
    git(["worktree", "remove", "--force", worktreePath(taskId)], repoRoot);
  } catch {
    /* best-effort cleanup */
  }
}
