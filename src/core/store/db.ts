// Core-store database: open/migrate + typed helpers.
// Single-file SQLite under ~/.loom/state/<projectId>.db (or test temp).

// Type-only import (erased at runtime) — the actual driver is loaded
// conditionally below, because better-sqlite3 is a native addon Bun can't
// dlopen. We use bun:sqlite under Bun and better-sqlite3 under Node (vitest).
import type Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loomDataDir } from "../paths.js";
import { CREATE_TABLES, SCHEMA_VERSION } from "./schema.js";
import { runMigrations } from "./migrations.js";

const requireDriver = createRequire(import.meta.url);

/** Open a SQLite database with the runtime-appropriate driver. Both
 *  better-sqlite3 and bun:sqlite expose the same prepare/run/get/all/exec
 *  surface the store relies on. WAL is enabled either way. */
function newDatabase(path: string): Database.Database {
  const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  if (hasBun) {
    const { Database: BunDatabase } = requireDriver("bun:sqlite");
    const db = new BunDatabase(path);
    db.exec("PRAGMA journal_mode = WAL");
    return db as unknown as Database.Database;
  }
  const BetterSqlite3 = requireDriver("better-sqlite3");
  const db = new BetterSqlite3(path);
  db.pragma("journal_mode = WAL");
  return db as Database.Database;
}

export function storeDir(): string {
  return join(loomDataDir(), "state");
}

export function storePath(projectId: string): string {
  return join(storeDir(), `${projectId}.db`);
}

/** Expected columns that may be missing on an older db (pre-live we evolve the
 *  schema directly, no version chain). Add any that are absent — idempotent, so
 *  the live schema always converges without breaking existing stores. */
const ENSURE_COLUMNS: Record<string, Array<{ name: string; ddl: string }>> = {
  tasks: [
    { name: "session_id", ddl: "session_id TEXT" },
    { name: "session_started", ddl: "session_started INTEGER NOT NULL DEFAULT 0" },
    // Per-model "lanes": a task runs different stages on different models (opus to
    // think, cheaper to do). Each model is its own Claude conversation, so we keep
    // a JSON map { model: laneSessionId } of the lanes started for this task.
    { name: "session_lanes", ddl: "session_lanes TEXT" },
    { name: "profile", ddl: "profile TEXT" },
    { name: "project_id", ddl: "project_id TEXT" },
    { name: "external_ref", ddl: "external_ref TEXT" },
  ],
};

function ensureColumns(db: Database.Database): void {
  for (const [table, cols] of Object.entries(ENSURE_COLUMNS)) {
    const have = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    for (const c of cols) if (!have.has(c.name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c.ddl}`);
  }
}

export function openStore(path?: string, projectId?: string): Database.Database {
  const p = path ?? storePath(projectId ?? "default");
  mkdirSync(dirname(p), { recursive: true });
  const db = newDatabase(p);
  db.exec(CREATE_TABLES);
  ensureColumns(db); // self-heal: add any columns missing on an older store

  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    // Fresh db: CREATE_TABLES built it at the current version.
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION),
    );
  } else {
    // Existing db: migrate forward if it predates the current schema.
    const stored = Number(row.value) || 0;
    if (stored < SCHEMA_VERSION) {
      const reached = runMigrations(db, stored, SCHEMA_VERSION);
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(reached));
    }
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
  profile: string | null;
  project_id: string | null;
  external_ref: string | null;
  session_id: string | null;
  session_started: number;
  session_lanes: string | null;
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
  profile?: string;
  projectId?: string;
  /** External tracker item id (e.g. bd issue id) — anchors idempotent import. */
  externalRef?: string;
}

export const STAGE_KEYS = [
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
    `INSERT INTO tasks (id, title, status, run_mode, route, repo, branch, description, profile, project_id, external_ref, created_at, updated_at)
     VALUES (?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    input.run_mode ?? "gated",
    JSON.stringify(route),
    input.repo ?? null,
    input.branch ?? null,
    input.description ?? null,
    input.profile ?? null,
    input.projectId ?? null,
    input.externalRef ?? null,
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

/** Find a task previously imported from the given external tracker item, if any.
 *  Anchors idempotent import — a draft whose externalId already has a task is skipped. */
export function findTaskByExternalRef(db: Database.Database, ref: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE external_ref = ?").get(ref) as TaskRow | undefined;
}

export function listTasks(db: Database.Database): TaskRow[] {
  return db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC").all() as TaskRow[];
}

// Delete a task and ALL its child rows in one transaction. Children are removed
// before the parent so no foreign-key reference dangles. Returns true if the
// task existed (a row was deleted), false otherwise.
export function deleteTask(db: Database.Database, id: string): boolean {
  const tx = db.transaction((taskId: string) => {
    for (const table of [
      "stages",
      "steps",
      "runs",
      "cost_rollups",
      "artifacts",
      "chat_messages",
      "attachments",
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE task_id = ?`).run(taskId);
    }
    // Per-task settings live in `settings` under a string key (no task_id column);
    // drop the task's permission allowlist so it doesn't linger as an orphan.
    db.prepare("DELETE FROM settings WHERE key = ?").run(`perm.allow.${taskId}`);
    return db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId).changes > 0;
  });
  return tx(id);
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

// ─── Task session (one persistent Claude session per task) ───────────────────

/** Set the task's session id (uuid) and mark it created so later stage calls
 *  resume it instead of starting a new one. */
export function setTaskSession(db: Database.Database, id: string, sessionId: string): void {
  db.prepare("UPDATE tasks SET session_id = ?, session_started = 1, updated_at = ? WHERE id = ?").run(
    sessionId,
    Date.now(),
    id,
  );
}

/** Switch the subscription this task's session runs under. The sessionId is
 *  unchanged — the caller re-launches with --resume so the conversation
 *  continues under the new profile. */
export function setTaskProfile(db: Database.Database, id: string, profile: string): void {
  db.prepare("UPDATE tasks SET profile = ?, updated_at = ? WHERE id = ?").run(profile, Date.now(), id);
}

/** The task's session: its id and whether it has been created yet (resume vs new). */
export function getTaskSession(db: Database.Database, id: string): { sessionId: string | null; started: boolean } {
  const t = getTask(db, id);
  return { sessionId: t?.session_id ?? null, started: !!t?.session_started };
}

function readLanes(db: Database.Database, id: string): Record<string, string> {
  const t = getTask(db, id);
  if (!t?.session_lanes) return {};
  try {
    const o = JSON.parse(t.session_lanes);
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The Claude session id for one model lane of a task, and whether it has been
 *  started yet (resume vs create). Lanes let different stages run on different
 *  models — each model is its own Claude conversation. */
export function getLaneSession(db: Database.Database, id: string, model: string): { sessionId: string | null; started: boolean } {
  const sid = readLanes(db, id)[model] ?? null;
  return { sessionId: sid, started: sid !== null };
}

/** Record the session id started for a model lane. */
export function setLaneSession(db: Database.Database, id: string, model: string, sessionId: string): void {
  const lanes = readLanes(db, id);
  lanes[model] = sessionId;
  db.prepare("UPDATE tasks SET session_lanes = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(lanes), Date.now(), id);
}

/** Every Claude session id across a task's model lanes — for cost/denials/stop
 *  fan-out (operations that must span all of a task's conversations). */
export function getLaneSessionIds(db: Database.Database, id: string): string[] {
  return Object.values(readLanes(db, id));
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
