// L14 — tail of the pipeline. PR: build a description (from the task + accepted
// spec; tj export-pr can be injected) and optionally push + open a PR via gh.
// Done: close the task (task-journal) + audit.done event + mark status done.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { createArtifact, latestArtifact } from "../store/artifacts.js";
import { getTask } from "../store/db.js";
import { makeEvent } from "../spine/event.js";
import { appendLoomEvent } from "../spine/event-bus.js";

const id = () => `art_${randomBytes(6).toString("hex")}`;

export type Sh = (cmd: string, args: string[], cwd?: string) => { code: number; stdout: string };

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
  created: boolean;
  url?: string;
}

/** L14.1 — produce the PR description artifact; optionally create the PR. */
export function runPr(db: Database.Database, taskId: string, opts: PrOptions = {}): PrResult {
  const description = opts.describe ? opts.describe() : defaultDescription(db, taskId);
  createArtifact(db, { id: id(), taskId, stage: "pr", kind: "pr-description", content: description, status: "accepted" });

  if (opts.connector && opts.sh && opts.repoRoot && opts.branch) {
    const base = opts.base ?? "main";
    opts.sh("git", ["push", "-u", "origin", opts.branch], opts.repoRoot);
    const title = getTask(db, taskId)?.title ?? taskId;
    const res = opts.sh(
      "gh",
      ["pr", "create", "--base", base, "--head", opts.branch, "--title", title, "--body", description],
      opts.repoRoot,
    );
    const url = res.stdout.trim().split("\n").pop();
    return { description, created: res.code === 0, url: res.code === 0 ? url : undefined };
  }
  return { description, created: false };
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
  appendLoomEvent(
    opts.projectId,
    makeEvent({ ts: Date.now(), source: "loom", projectId: opts.projectId, taskId, type: "task.done" }),
  );
}
