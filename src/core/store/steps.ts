// Step CRUD — the R&D plan rows (the per-task DAG) in the core store.

import type Database from "better-sqlite3";

export interface StepInput {
  id: string;
  taskId: string;
  title: string;
  approach?: string;
  files?: string[];
  agent?: string;
  model?: string;
  profile?: string;
  dependsOn?: string[];
}

export interface StepRow {
  id: string;
  task_id: string;
  title: string;
  approach: string | null;
  files: string | null;
  agent: string | null;
  model: string | null;
  profile: string | null;
  depends_on: string | null;
  status: string;
  exit_code: number | null;
  started_at: number | null;
  finished_at: number | null;
}

export function createStep(db: Database.Database, input: StepInput): void {
  db.prepare(
    `INSERT INTO steps (id, task_id, title, approach, files, agent, model, profile, depends_on, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(
    input.id,
    input.taskId,
    input.title,
    input.approach ?? null,
    input.files ? JSON.stringify(input.files) : null,
    input.agent ?? null,
    input.model ?? null,
    input.profile ?? null,
    input.dependsOn ? JSON.stringify(input.dependsOn) : null,
  );
}

export function getSteps(db: Database.Database, taskId: string): StepRow[] {
  return db
    .prepare("SELECT * FROM steps WHERE task_id = ? ORDER BY rowid")
    .all(taskId) as StepRow[];
}

export function updateStepStatus(
  db: Database.Database,
  id: string,
  status: string,
  exitCode?: number,
): void {
  const now = Date.now();
  if (status === "running") {
    db.prepare(
      "UPDATE steps SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?",
    ).run(status, now, id);
  } else if (status === "done" || status === "failed") {
    db.prepare(
      "UPDATE steps SET status = ?, exit_code = ?, finished_at = ? WHERE id = ?",
    ).run(status, exitCode ?? null, now, id);
  } else {
    db.prepare("UPDATE steps SET status = ? WHERE id = ?").run(status, id);
  }
}

/** Assign the router's choice (profile + optional model) to a step. */
export function assignStep(
  db: Database.Database,
  id: string,
  profile: string,
  model?: string,
): void {
  db.prepare("UPDATE steps SET profile = ?, model = ? WHERE id = ?").run(
    profile,
    model ?? null,
    id,
  );
}

/** Parse a step's depends_on JSON into a string[] (empty when none). */
export function stepDeps(step: StepRow): string[] {
  if (!step.depends_on) return [];
  try {
    const v = JSON.parse(step.depends_on);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
