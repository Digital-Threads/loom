// After the impl stage runs in a sandbox worktree, the agent's file edits are
// uncommitted. The orchestrator commits them so the PR stage has content to
// push. Git runner injected for testability; a no-change worktree commits
// nothing (returns committed:false) rather than erroring.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

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

// Session/tool artifacts that leak into the worktree cwd — the spawned agent's
// Claude config and token-pilot runtime files — and must never land in the
// task's commit/PR (loom-isd). Excluded via the worktree-local git exclude
// before staging, so a fresh worktree never tracks them.
const ARTIFACT_PATTERNS = [".claude/", ".token-pilot/", ".token-pilot-fingerprint.json"];

function excludeArtifacts(cwd: string, git: GitSh): void {
  const rel = git(["rev-parse", "--git-path", "info/exclude"], cwd).stdout.trim();
  if (!rel) return;
  const path = isAbsolute(rel) ? rel : join(cwd, rel);
  try {
    const have = existsSync(path) ? readFileSync(path, "utf8") : "";
    const lines = have.split("\n");
    const missing = ARTIFACT_PATTERNS.filter((p) => !lines.includes(p));
    if (missing.length) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, (have && !have.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n");
    }
  } catch {
    /* best-effort: a missing exclude path just means no extra filtering */
  }
}

/** Stage and commit all changes in a worktree. Returns committed:false when the
 *  tree is clean (nothing to commit). Session/tool artifacts are excluded so the
 *  commit carries only the task's real work. */
export function commitWorktree(cwd: string, message: string, git: GitSh = defaultGit): { committed: boolean } {
  excludeArtifacts(cwd, git);
  git(["add", "-A"], cwd);
  const status = git(["status", "--porcelain"], cwd);
  if (!status.stdout.trim()) return { committed: false };
  const res = git(["commit", "-m", message], cwd);
  return { committed: res.code === 0 };
}

/** Rebase the worktree branch onto its base branch (first of `candidates` that
 *  exists) so the PR / diff reflects only the task's own changes — not drift
 *  from a base that moved during the run (loom-705a). On conflict the rebase is
 *  aborted and `conflict:true` returned so the caller can park for a human.
 *  base:null when no candidate ref exists (nothing to rebase onto). */
export function rebaseWorktreeOnBase(
  cwd: string,
  candidates: Array<string | null | undefined>,
  git: GitSh = defaultGit,
): { base: string | null; conflict: boolean } {
  let base: string | null = null;
  for (const r of candidates) {
    if (r && git(["rev-parse", "--verify", "--quiet", r], cwd).code === 0) { base = r; break; }
  }
  if (!base) return { base: null, conflict: false };
  const res = git(["rebase", base], cwd);
  if (res.code !== 0) {
    git(["rebase", "--abort"], cwd);
    return { base, conflict: true };
  }
  return { base, conflict: false };
}
