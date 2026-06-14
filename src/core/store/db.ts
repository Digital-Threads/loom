// Core-store database: open/migrate + typed helpers.
// Single-file SQLite under ~/.loom/state/<projectId>.db (or test temp).

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loomDataDir } from "../paths.js";
import { CREATE_TABLES, SCHEMA_VERSION } from "./schema.js";

export function storeDir(): string {
  return join(loomDataDir(), "state");
}

export function storePath(projectId: string): string {
  return join(storeDir(), `${projectId}.db`);
}

export function openStore(path?: string, projectId?: string): Database.Database {
  const p = path ?? storePath(projectId ?? "default");
  mkdirSync(dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec(CREATE_TABLES);

  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION),
    );
  }
  return db;
}

// ─── Task CRUD ──────────────────────────────────────────────────────────────

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  run_mode: string;
  route: string | null;
  repo: string | null;
  branch: string | null;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateTaskInput {
  id: string;
  title: string;
  run_mode?: string;
  route?: string[];
  repo?: string;
  branch?: string;
  description?: string;
}

const STAGE_KEYS = [
  "analysis",
  "brainstorm",
  "spec",
  "rd",
  "impl",
  "review",
  "qa",
  "pr",
  "done",
] as const;

export function createTask(db: Database.Database, input: CreateTaskInput): TaskRow {
  const now = Date.now();
  const route = input.route ?? STAGE_KEYS.slice();
  db.prepare(
    `INSERT INTO tasks (id, title, status, run_mode, route, repo, branch, description, created_at, updated_at)
     VALUES (?, ?, 'created', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    input.run_mode ?? "gated",
    JSON.stringify(route),
    input.repo ?? null,
    input.branch ?? null,
    input.description ?? null,
    now,
    now,
  );

  // Seed stage rows for the route, with skipped for non-route stages.
  const routeSet = new Set(route);
  const insert = db.prepare(
    `INSERT INTO stages (task_id, stage_key, status, gate) VALUES (?, ?, ?, ?)`,
  );
  for (const key of STAGE_KEYS) {
    const inRoute = routeSet.has(key);
    insert.run(input.id, key, inRoute ? "pending" : "skipped", inRoute ? 1 : 0);
  }

  return getTask(db, input.id)!;
}

export function getTask(db: Database.Database, id: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
}

export function listTasks(db: Database.Database): TaskRow[] {
  return db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC").all() as TaskRow[];
}

export function updateTaskStatus(
  db: Database.Database,
  id: string,
  status: string,
): void {
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    Date.now(),
    id,
  );
}

// ─── Stage helpers ──────────────────────────────────────────────────────────

export interface StageRow {
  task_id: string;
  stage_key: string;
  status: string;
  gate: number;
  started_at: number | null;
  finished_at: number | null;
}

export function getStages(db: Database.Database, taskId: string): StageRow[] {
  return db
    .prepare("SELECT * FROM stages WHERE task_id = ? ORDER BY rowid")
    .all(taskId) as StageRow[];
}

export function updateStageStatus(
  db: Database.Database,
  taskId: string,
  stageKey: string,
  status: string,
): void {
  const now = Date.now();
  const set =
    status === "active"
      ? "status = ?, started_at = COALESCE(started_at, ?)"
      : status === "done" || status === "skipped"
        ? "status = ?, finished_at = ?"
        : "status = ?";
  const args =
    status === "active" || status === "done" || status === "skipped"
      ? [status, now, taskId, stageKey]
      : [status, taskId, stageKey];
  db.prepare(
    `UPDATE stages SET ${set} WHERE task_id = ? AND stage_key = ?`,
  ).run(...args);
}

export function setStageGate(
  db: Database.Database,
  taskId: string,
  stageKey: string,
  gate: boolean,
): void {
  db.prepare("UPDATE stages SET gate = ? WHERE task_id = ? AND stage_key = ?").run(
    gate ? 1 : 0,
    taskId,
    stageKey,
  );
}
