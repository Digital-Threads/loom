// Pipeline engine — the headless brain behind the board. Drives a task through
// its adaptive route in the core store: which stage is current, advance to the
// next, mark skipped ones, expose the board view-model and the attention queue.
// UI (TUI today, web later) renders these; the logic lives here.

import type Database from "better-sqlite3";
import {
  STAGE_KEYS,
  getStages,
  getTask,
  listTasks,
  updateStageStatus,
  updateTaskStatus,
  type StageRow,
} from "../store/db.js";

/** The task's current position: first route stage not done/skipped. */
export function currentStage(stages: StageRow[]): StageRow | undefined {
  return stages.find((s) => s.status === "pending" || s.status === "active");
}

/** Activate the first route stage; mark the task running. No-op if already started. */
export function startTask(db: Database.Database, taskId: string): string | null {
  const first = getStages(db, taskId).find((s) => s.status === "pending");
  if (!first) return null;
  updateStageStatus(db, taskId, first.stage_key, "active");
  updateTaskStatus(db, taskId, "running");
  return first.stage_key;
}

/**
 * Complete the given stage and activate the next pending route stage (skipped
 * stages are already marked and are passed over). Returns the new active stage
 * key, or null when the task has reached the end (task → done).
 */
export function completeStage(
  db: Database.Database,
  taskId: string,
  stageKey: string,
): string | null {
  updateStageStatus(db, taskId, stageKey, "done");
  const next = getStages(db, taskId).find((s) => s.status === "pending");
  if (next) {
    updateStageStatus(db, taskId, next.stage_key, "active");
    return next.stage_key;
  }
  updateTaskStatus(db, taskId, "done");
  return null;
}

/**
 * Move a task so its current position becomes `stageKey` (Kanban drag-drop):
 * in-route stages before the target → done, the target → active, after → pending;
 * non-route (skipped) stages are left untouched. Dropping on `done` finishes the
 * task. Returns the new current stage key, or null if the stage is unknown.
 * Repositions only — it does not start a run (running stays an explicit action).
 */
export function moveToStage(db: Database.Database, taskId: string, stageKey: string): string | null {
  const stages = getStages(db, taskId);
  const targetIdx = STAGE_KEYS.indexOf(stageKey as (typeof STAGE_KEYS)[number]);
  if (targetIdx < 0 || !stages.some((s) => s.stage_key === stageKey)) return null;

  if (stageKey === "done") {
    for (const s of stages) if (s.status !== "skipped") updateStageStatus(db, taskId, s.stage_key, "done");
    updateTaskStatus(db, taskId, "done");
    return null;
  }
  for (const s of stages) {
    if (s.stage_key === stageKey) updateStageStatus(db, taskId, s.stage_key, "active");
    else if (s.status === "skipped") continue;
    else updateStageStatus(db, taskId, s.stage_key, STAGE_KEYS.indexOf(s.stage_key as (typeof STAGE_KEYS)[number]) < targetIdx ? "done" : "pending");
  }
  // Repositioning doesn't start work: a fresh task stays "created", a finished
  // task moved back re-opens to "running"; an in-progress task is left as-is.
  const task = getTask(db, taskId);
  if (task?.status === "done") updateTaskStatus(db, taskId, "running");
  return stageKey;
}

export interface BoardCard {
  id: string;
  title: string;
  stageKey: string;
  status: string;
  projectId: string; // owning project ("" if not yet assigned → home project)
}

export interface BoardColumn {
  stageKey: string;
  cards: BoardCard[];
}

/** Board view-model: 9 fixed columns (stages), each holding the tasks whose
 *  current position is that stage. Finished tasks land in `done`. */
export function boardColumns(db: Database.Database): BoardColumn[] {
  const cols: BoardColumn[] = STAGE_KEYS.map((k) => ({ stageKey: k, cards: [] }));
  const byKey = new Map(cols.map((c) => [c.stageKey, c]));
  for (const t of listTasks(db)) {
    const cur = currentStage(getStages(db, t.id));
    const key = cur ? cur.stage_key : "done";
    byKey.get(key)?.cards.push({ id: t.id, title: t.title, stageKey: key, status: t.status, projectId: t.project_id ?? "" });
  }
  return cols;
}

export interface AttentionItem {
  taskId: string;
  title: string;
  stageKey: string;
}

/** "Требует внимания": tasks parked at an active, gated stage awaiting approval. */
export function attentionQueue(db: Database.Database): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const t of listTasks(db)) {
    const cur = currentStage(getStages(db, t.id));
    if (cur && cur.status === "active" && cur.gate === 1) {
      out.push({ taskId: t.id, title: t.title, stageKey: cur.stage_key });
    }
  }
  return out;
}
