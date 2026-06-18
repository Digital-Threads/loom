import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTask, updateTaskStatus } from "../../src/core/store/db.js";
import { worktreePath } from "../../src/core/security/sandbox.js";
import { resolveProjectRoot } from "../../src/core/workspace/project-id.js";
import { createApi } from "../../src/web/api.js";
import { exportEventsSafe, tasksFromEvents } from "../../src/core/plugins/task-journal/adapter.js";
import type Database from "better-sqlite3";
import type { Hono } from "hono";

// C2 — the task journal must be guaranteed by the host, not by whether the agent
// happened to call task_create: bootstrap on worktree creation, snapshot on every
// park, and an explicit "no journal" mark for empty / non-git tasks.

let dir: string;
let db: Database.Database;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-journal-"));
  db = openStore(join(dir, "test.db"));
  app = createApi(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const packOf = async (id: string): Promise<string> =>
  ((await (await app.request(`/api/memory/board/${id}`)).json()) as { pack: string }).pack;

// The "empty journal" mark + the start-bootstrap need the real task-journal CLI
// (+ git). Guarded so they skip cleanly where either is missing — never red/flaky.
const itIntegration = tjAvailable() && gitAvailable() ? it : it.skip;

describe("C2 journal guarantee — park & no-journal marks", () => {
  it("parking a non-git task marks it 'no journal' and surfaces it in the board pack", async () => {
    createTask(db, { id: "tn", title: "No repo" }); // non-git → no 1:1 journal project
    updateTaskStatus(db, "tn", "running");

    const res = await app.request("/api/tasks/tn/stop", { method: "POST" });
    expect(res.status).toBe(200);
    expect(getTask(db, "tn")?.status).toBe("waiting"); // parked

    const pack = await packOf("tn");
    expect(pack).toContain("No reasoning journal");
    expect(pack).toContain("non-git task");
  });

  itIntegration("parking a git task with no recorded events marks it empty (agent recorded nothing)", async () => {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true }); // isGitRepo(repo) → true (no worktree/events though)
    createTask(db, { id: "tg", title: "Git empty", repo });
    updateTaskStatus(db, "tg", "running");

    await app.request("/api/tasks/tg/stop", { method: "POST" });
    expect(getTask(db, "tg")?.status).toBe("waiting");

    const pack = await packOf("tg");
    expect(pack).toContain("No reasoning journal");
    expect(pack).toContain("agent recorded nothing");
  });

  it("a finished task is never re-parked (park is a no-op once done)", async () => {
    createTask(db, { id: "td", title: "Done" });
    updateTaskStatus(db, "td", "done");

    await app.request("/api/tasks/td/stop", { method: "POST" });
    expect(getTask(db, "td")?.status).toBe("done"); // stayed done, not flipped to waiting

    // no journal-status mark was written for a done task → board pack stays empty
    expect(await packOf("td")).toBe("");
  });
});

// ── Bootstrap-on-start: needs real git + the task-journal CLI. Guarded so it
//    skips cleanly where either is missing — never red/flaky.
function tjAvailable(): boolean {
  try { execFileSync("task-journal", ["--version"], { encoding: "utf8" }); return true; } catch { return false; }
}
function gitAvailable(): boolean {
  try { execFileSync("git", ["--version"], { encoding: "utf8" }); return true; } catch { return false; }
}

function gitRepoWithCommit(repo: string): void {
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  writeFileSync(join(repo, "f.txt"), "x\n");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
}

describe("C2 journal guarantee — bootstrap on worktree creation (integration)", () => {
  // Uses the REAL default worktree base (~/.loom/worktrees/<id>) so worktreePath()
  // and ensureWorktree() agree — configureSecurity({dataDir}) does NOT redirect
  // this base, so overriding it only desyncs the two. The worktree + branch are
  // reclaimed via DELETE in the finally so nothing leaks.
  itIntegration("creates and binds a journal task at start, independent of the agent, and is idempotent", async () => {
    const repo = join(dir, "repo");
    gitRepoWithCommit(repo);
    const id = "it-journal-boot";
    createTask(db, { id, title: "Bootstrap me", repo });
    const app2 = createApi(db);
    try {
      // /diff resolves taskCwd → ensureWorktree → ensureJournalTask (no agent run).
      const r1 = await app2.request(`/api/tasks/${id}/diff`);
      expect(r1.status).toBe(200);
      const root = resolveProjectRoot(worktreePath(id)); // the root the host reads/writes for this task
      const tasks1 = tasksFromEvents(exportEventsSafe(root));
      expect(tasks1.length).toBe(1); // the host opened a journal task on its own
      expect(tasks1[0].title).toBe("Bootstrap me");

      // A second worktree resolution must NOT open a duplicate journal task.
      await app2.request(`/api/tasks/${id}/diff`);
      expect(tasksFromEvents(exportEventsSafe(root)).length).toBe(1);
    } finally {
      await app2.request(`/api/tasks/${id}`, { method: "DELETE" }); // reclaim the real worktree + branch
    }
  });
});
