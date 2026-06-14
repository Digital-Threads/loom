// Execute contract: the capability a plugin declares when it can run work.
// The automation plugin will implement this; the core store records runs.
// This file defines the types and the store-side of run management.

import type Database from "better-sqlite3";

export interface RunInput {
  id: string;
  taskId: string;
  stepId?: string;
  workflowId?: string;
  sessionId?: string;
  profile?: string;
}

export interface RunRow {
  id: string;
  task_id: string;
  step_id: string | null;
  workflow_id: string | null;
  session_id: string | null;
  profile: string | null;
  status: string;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export function insertRun(db: Database.Database, input: RunInput): void {
  db.prepare(
    `INSERT INTO runs (id, task_id, step_id, workflow_id, session_id, profile, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
  ).run(
    input.id,
    input.taskId,
    input.stepId ?? null,
    input.workflowId ?? null,
    input.sessionId ?? null,
    input.profile ?? null,
    Date.now(),
  );
}

export function completeRun(
  db: Database.Database,
  runId: string,
  exitCode: number,
  stdout?: string,
  stderr?: string,
): void {
  db.prepare(
    `UPDATE runs SET status = ?, exit_code = ?, stdout = ?, stderr = ?, finished_at = ?
     WHERE id = ?`,
  ).run(exitCode === 0 ? "done" : "failed", exitCode, stdout ?? null, stderr ?? null, Date.now(), runId);
}

export function getRun(db: Database.Database, runId: string): RunRow | undefined {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
}

export function listRunsForTask(db: Database.Database, taskId: string): RunRow[] {
  return db
    .prepare("SELECT * FROM runs WHERE task_id = ? ORDER BY started_at")
    .all(taskId) as RunRow[];
}

// ─── Cost rollup ────────────────────────────────────────────────────────────

export interface CostRow {
  task_id: string;
  source: string;
  metric: string;
  value: number;
  exact: number;
  updated_at: number;
}

export function upsertCost(
  db: Database.Database,
  taskId: string,
  source: string,
  metric: string,
  value: number,
  exact: boolean,
): void {
  db.prepare(
    `INSERT INTO cost_rollups (task_id, source, metric, value, exact, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (task_id, source, metric)
     DO UPDATE SET value = excluded.value, exact = excluded.exact, updated_at = excluded.updated_at`,
  ).run(taskId, source, metric, value, exact ? 1 : 0, Date.now());
}

export function getCosts(db: Database.Database, taskId: string): CostRow[] {
  return db
    .prepare("SELECT * FROM cost_rollups WHERE task_id = ?")
    .all(taskId) as CostRow[];
}
