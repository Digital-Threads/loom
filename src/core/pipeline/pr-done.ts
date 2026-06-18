// L14 — tail of the pipeline. PR: build a description (from the task + accepted
// spec; tj export-pr can be injected) and optionally push + open a PR via gh.
// Done: close the task (task-journal) + audit.done event + mark status done.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { createArtifact, latestArtifact } from "../store/artifacts.js";
import { getTask, updateStageStatus } from "../store/db.js";
import { makeEvent } from "../spine/event.js";
import { appendLoomEvent } from "../spine/event-bus.js";

const id = () => `art_${randomBytes(6).toString("hex")}`;

export type Sh = (cmd: string, args: string[], cwd?: string) => Promise<{ code: number; stdout: string }>;

export interface PrOptions {
  /** Custom description builder (e.g. wraps `task-journal export-pr`). */
  describe?: () => string;
  /** When set with sh+branch+repoRoot, push + `gh pr create`. */
  connector?: boolean;
  base?: string;
  branch?: string;
  repoRoot?: string;
  sh?: Sh;
}

export interface PrResult {
  description: string;
  /** Whether a PR was actually opened (connector path succeeded). */
  created: boolean;
  url?: string;
  /** True when the user asked to push + open a PR (connector path attempted). */
  connector: boolean;
  /** Human-readable reason the PR wasn't created (missing gh / remote, push or
   *  `gh pr create` failure). Empty on success or description-only runs. */
  error?: string;
}

/** Is the GitHub PR connector usable in this repo: `gh` on PATH + an `origin`
 *  remote. Returned to the UI so the user knows whether "push + PR" will work. */
export async function prConnectorStatus(sh: Sh, repoRoot: string): Promise<{ gh: boolean; remote: boolean }> {
  const gh = (await sh("gh", ["--version"], repoRoot)).code === 0;
  const remote = (await sh("git", ["remote", "get-url", "origin"], repoRoot)).code === 0;
  return { gh, remote };
}

/** The branch a PR should target: origin's default branch (origin/HEAD), else a
 *  local master/main, else "main". Hardcoding "main" made `gh pr create --base
 *  main` fail with "Base ref must be a branch" on repos whose default is master. */
export async function defaultBranch(sh: Sh, repoRoot: string): Promise<string> {
  const head = await sh("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repoRoot);
  const named = head.code === 0 ? head.stdout.trim().replace(/^origin\//, "") : "";
  if (named) return named;
  for (const b of ["master", "main"]) {
    if ((await sh("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${b}`], repoRoot)).code === 0) return b;
  }
  return "main";
}

/** L14.1 — produce the PR description artifact; optionally create the PR. The
 *  connector path is best-effort but NEVER silent: every failure (missing gh,
 *  no remote, push/`gh pr create` non-zero) comes back as `error` for the UI.
 *  Async (the sh spawns git/gh): a sync spawn would block the server event loop. */
export async function runPr(db: Database.Database, taskId: string, opts: PrOptions = {}): Promise<PrResult> {
  const description = opts.describe ? opts.describe() : defaultDescription(db, taskId);
  createArtifact(db, { id: id(), taskId, stage: "pr", kind: "pr-description", content: description, status: "accepted" });

  if (!opts.connector) return { description, created: false, connector: false };

  // Connector requested but not wired up — report precisely instead of failing mute.
  if (!opts.sh || !opts.repoRoot || !opts.branch) {
    return { description, created: false, connector: true, error: "PR connector is not configured for this task (no repo/branch)." };
  }
  const { gh, remote } = await prConnectorStatus(opts.sh, opts.repoRoot);
  if (!gh) return { description, created: false, connector: true, error: "GitHub CLI (gh) is not installed or not on PATH — install gh and run `gh auth login`." };
  if (!remote) return { description, created: false, connector: true, error: "This repo has no `origin` remote — add a GitHub remote before opening a PR." };

  const base = opts.base ?? (await defaultBranch(opts.sh, opts.repoRoot));
  const push = await opts.sh("git", ["push", "-u", "origin", opts.branch], opts.repoRoot);
  if (push.code !== 0) {
    return { description, created: false, connector: true, error: `git push failed:\n${push.stdout.trim() || "(no output)"}` };
  }
  const title = getTask(db, taskId)?.title ?? taskId;
  const res = await opts.sh(
    "gh",
    ["pr", "create", "--base", base, "--head", opts.branch, "--title", title, "--body", description],
    opts.repoRoot,
  );
  if (res.code !== 0) {
    return { description, created: false, connector: true, error: `gh pr create failed:\n${res.stdout.trim() || "(no output)"}` };
  }
  const url = res.stdout.trim().split("\n").pop();
  return { description, created: true, connector: true, url };
}

function defaultDescription(db: Database.Database, taskId: string): string {
  const t = getTask(db, taskId);
  const spec = latestArtifact(db, taskId, "spec-md")?.content;
  return [
    `# ${t?.title ?? taskId}`,
    "",
    t?.description ?? "",
    spec ? `\n## Spec\n\n${spec}` : "",
  ].join("\n");
}

export interface DoneOptions {
  projectId: string;
  /** Close the task in task-journal (injected; the adapter call). */
  closeTask?: () => void;
}

/** L14.2 — finalize: close the task, audit, mark done. */
export function runDone(db: Database.Database, taskId: string, opts: DoneOptions): void {
  try {
    opts.closeTask?.();
  } catch {
    /* journal close is best-effort */
  }
  db.prepare("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?").run(Date.now(), taskId);
  // The task is finished — close out the tail stages too, else the task screen
  // shows pr "active" / done "pending" forever even though the task is done.
  updateStageStatus(db, taskId, "pr", "done");
  updateStageStatus(db, taskId, "done", "done");
  appendLoomEvent(
    opts.projectId,
    makeEvent({ ts: Date.now(), source: "loom", projectId: opts.projectId, taskId, type: "task.done" }),
  );
}
