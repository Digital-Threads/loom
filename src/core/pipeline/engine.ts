// Pipeline engine — the headless brain behind the board. Drives a task through
// its adaptive route in the core store: which stage is current, advance to the
// next, mark skipped ones, expose the board view-model and the attention queue.
// UI (TUI today, web later) renders these; the logic lives here.

import type Database from "better-sqlite3";
import {
  STAGE_KEYS,
  getStages,
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

export interface BoardCard {
  id: string;
  title: string;
  stageKey: string;
  status: string;
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
    byKey.get(key)?.cards.push({ id: t.id, title: t.title, stageKey: key, status: t.status });
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
