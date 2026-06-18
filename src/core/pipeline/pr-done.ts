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
  /** Legacy: a PR was auto-opened. We no longer auto-create PRs (host-agnostic),
   *  so this stays false; kept so older stored results still render. */
  created: boolean;
  /** The branch was pushed to origin (the connector's real action). */
  pushed?: boolean;
  /** Host's "open a PR/MR" URL for the pushed branch (GitHub/GitLab/Bitbucket) —
   *  the user clicks it to create the PR themselves. Undefined for an unknown host. */
  compareUrl?: string;
  url?: string; // legacy alias of compareUrl (older UI reads `url`)
  /** True when the user asked to push (connector path attempted). */
  connector: boolean;
  /** Human-readable reason the push/link failed (no remote, push non-zero). */
  error?: string;
}

/** Can the connector run for this repo: just an `origin` remote (we push the
 *  branch and return a host link — no `gh`, so any host works). */
export async function prConnectorStatus(sh: Sh, repoRoot: string): Promise<{ remote: boolean }> {
  const remote = (await sh("git", ["remote", "get-url", "origin"], repoRoot)).code === 0;
  return { remote };
}

/** Build the host's "open a new PR/MR for this branch" URL from an origin remote
 *  URL — host-agnostic (GitHub/GitLab/Bitbucket). Returns null for an unknown
 *  host so the caller can tell the user to open it manually. We never create the
 *  PR ourselves; the user clicks the link and opens it on whatever forge it is. */
export function prCompareUrl(remoteUrl: string, base: string, branch: string): string | null {
  const m = /(?:git@|ssh:\/\/git@|https?:\/\/)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  if (!m) return null;
  const host = m[1];
  const path = m[2];
  // Query-param hosts (GitLab/Bitbucket): full encoding. Path-based host (GitHub
  // compare): per-segment encoding so a `loom/t1` ref keeps its slashes.
  const b = encodeURIComponent(branch);
  const t = encodeURIComponent(base);
  const bp = branch.split("/").map(encodeURIComponent).join("/");
  const tp = base.split("/").map(encodeURIComponent).join("/");
  if (host === "github.com") return `https://github.com/${path}/compare/${tp}...${bp}?expand=1`;
  if (host === "bitbucket.org") return `https://bitbucket.org/${path}/pull-requests/new?source=${b}&dest=${t}`;
  if (host.includes("gitlab")) return `https://${host}/${path}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${b}&merge_request%5Btarget_branch%5D=${t}`;
  return null;
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

/** L14.1 — produce the PR description artifact; with the connector on, push the
 *  branch to origin and return the host's "open a PR/MR" link (the user creates
 *  the PR themselves — we never auto-create, so it works on GitHub/GitLab/
 *  Bitbucket alike). Best-effort but never silent: no remote / push failure comes
 *  back as `error`. Async (the sh spawns git): a sync spawn would block the loop. */
export async function runPr(db: Database.Database, taskId: string, opts: PrOptions = {}): Promise<PrResult> {
  const description = opts.describe ? opts.describe() : defaultDescription(db, taskId);
  createArtifact(db, { id: id(), taskId, stage: "pr", kind: "pr-description", content: description, status: "accepted" });

  if (!opts.connector) return { description, created: false, pushed: false, connector: false };

  // Connector requested but not wired up — report precisely instead of failing mute.
  if (!opts.sh || !opts.repoRoot || !opts.branch) {
    return { description, created: false, pushed: false, connector: true, error: "Push is not configured for this task (no repo/branch)." };
  }
  const remoteRes = await opts.sh("git", ["remote", "get-url", "origin"], opts.repoRoot);
  if (remoteRes.code !== 0) {
    return { description, created: false, pushed: false, connector: true, error: "This repo has no `origin` remote — add one before pushing." };
  }
  const base = opts.base ?? (await defaultBranch(opts.sh, opts.repoRoot));
  const push = await opts.sh("git", ["push", "-u", "origin", opts.branch], opts.repoRoot);
  if (push.code !== 0) {
    return { description, created: false, pushed: false, connector: true, error: `git push failed:\n${push.stdout.trim() || "(no output)"}` };
  }
  const compareUrl = prCompareUrl(remoteRes.stdout, base, opts.branch) ?? undefined;
  return { description, created: false, pushed: true, connector: true, compareUrl, url: compareUrl };
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
