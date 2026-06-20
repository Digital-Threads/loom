// Sandbox — run agent work in an isolated git worktree so the autopilot never
// mutates the user's working tree directly. Thin wrapper over `git worktree`;
// the git runner is injected so it's testable without a real repo.

import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { securityDataDir } from "./config.js";

export type GitRunner = (args: string[], cwd: string) => string;
/** Symlink src→dst (injectable for tests). */
export type Linker = (src: string, dst: string) => void;

const defaultGit: GitRunner = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

const defaultLink: Linker = (src, dst) => symlinkSync(src, dst);

// node_modules isn't tracked by git, so a fresh worktree has none — agents would
// waste tokens running `npm/bun install`, and QA (which runs the repo's test/
// build scripts) would fail with missing deps. Symlink the repo's installed
// node_modules into the worktree instead. Covers the root and the web subpackage.
const NODE_MODULES_DIRS = ["node_modules", "web/node_modules"];

function linkNodeModules(
  repoRoot: string,
  wtPath: string,
  exists: (p: string) => boolean,
  link: Linker,
): void {
  for (const rel of NODE_MODULES_DIRS) {
    const src = join(repoRoot, rel);
    const dst = join(wtPath, rel);
    if (exists(src) && !exists(dst)) {
      try { link(src, dst); } catch { /* best-effort: agent can still install */ }
    }
  }
}

export interface Worktree {
  path: string;
  branch: string;
}

export function worktreeBranch(taskId: string): string {
  return `loom/${taskId}`;
}

export function worktreePath(taskId: string): string {
  return join(securityDataDir(), "worktrees", taskId);
}

/** Impl-swarm: each attempt gets its OWN worktree + branch under the task, so N
 *  candidate implementations don't collide. Slot is the attempt index. */
export function swarmWorktreeBranch(taskId: string, slot: number): string {
  return `loom/${taskId}/sw${slot}`;
}
export function swarmWorktreePath(taskId: string, slot: number): string {
  return join(securityDataDir(), "worktrees", taskId, `sw${slot}`);
}

export interface SandboxOptions {
  /** Base ref to branch from (default: current HEAD). */
  base?: string;
  git?: GitRunner;
  /** Symlink node_modules into the worktree (default: real symlink). */
  link?: Linker;
  exists?: (p: string) => boolean;
}

/** True if a local branch already exists (the git runner throws on a non-zero
 *  exit, so a clean return means the ref resolved). */
function branchExists(git: GitRunner, repoRoot: string, branch: string): boolean {
  try {
    git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
    return true;
  } catch {
    return false;
  }
}

/** Create an isolated worktree + branch for a task. Returns its path/branch.
 *  Robust to a LEFTOVER branch: if a prior run's branch still exists (the worktree
 *  dir was removed but the branch wasn't), ATTACH it instead of `-b` (which would
 *  fail "branch already exists" and wedge the task — every run failing on worktree
 *  setup). Prunes stale worktree registrations first. */
export function prepareWorktree(
  repoRoot: string,
  taskId: string,
  opts: SandboxOptions = {},
): Worktree {
  return prepareWorktreeAt(repoRoot, worktreePath(taskId), worktreeBranch(taskId), opts);
}

/** Core worktree setup at an EXPLICIT path/branch — shared by the per-task
 *  worktree and the per-attempt impl-swarm worktrees. */
function prepareWorktreeAt(repoRoot: string, path: string, branch: string, opts: SandboxOptions): Worktree {
  const git = opts.git ?? defaultGit;
  const exists = opts.exists ?? ((p: string) => existsSync(p));
  try { git(["worktree", "prune"], repoRoot); } catch { /* best-effort: drop ghost registrations */ }
  const args = branchExists(git, repoRoot, branch)
    ? ["worktree", "add", path, branch] // reuse the existing branch
    : ["worktree", "add", "-b", branch, path, ...(opts.base ? [opts.base] : [])];
  git(args, repoRoot);
  linkNodeModules(repoRoot, path, exists, opts.link ?? defaultLink);
  return { path, branch };
}

/** Impl-swarm: prepare attempt `slot`'s isolated worktree (worktrees/<id>/sw<k>
 *  on branch loom/<id>/sw<k>). Each candidate implementation lives in its own. */
export function prepareSwarmWorktree(repoRoot: string, taskId: string, slot: number, opts: SandboxOptions = {}): Worktree {
  return prepareWorktreeAt(repoRoot, swarmWorktreePath(taskId, slot), swarmWorktreeBranch(taskId, slot), opts);
}

/** Remove an impl-swarm attempt's worktree + branch (best-effort) — the losing
 *  candidates are cleaned up after the judge elects a winner. */
export function removeSwarmWorktree(repoRoot: string, taskId: string, slot: number, opts: SandboxOptions = {}): void {
  const git = opts.git ?? defaultGit;
  try { git(["worktree", "remove", "--force", swarmWorktreePath(taskId, slot)], repoRoot); } catch { /* best-effort */ }
  try { git(["branch", "-D", swarmWorktreeBranch(taskId, slot)], repoRoot); } catch { /* best-effort */ }
  try { git(["worktree", "prune"], repoRoot); } catch { /* best-effort */ }
}

/** Idempotent worktree for a task: one worktree per task, reused across stages
 *  (the whole session lives in it). Creates it on first use, returns it after. */
export function ensureWorktree(
  repoRoot: string,
  taskId: string,
  opts: SandboxOptions & { exists?: (p: string) => boolean } = {},
): Worktree {
  const path = worktreePath(taskId);
  const branch = worktreeBranch(taskId);
  const exists = opts.exists ?? ((p: string) => existsSync(p));
  if (exists(path)) return { path, branch };
  return prepareWorktree(repoRoot, taskId, opts);
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
  // Also delete the task branch + prune, so a re-run can recreate cleanly. Without
  // this the branch lingers and `worktree add -b` fails next time (prepareWorktree
  // now recovers by attaching, but don't leave the orphan around either).
  try { git(["branch", "-D", worktreeBranch(taskId)], repoRoot); } catch { /* best-effort */ }
  try { git(["worktree", "prune"], repoRoot); } catch { /* best-effort */ }
}
