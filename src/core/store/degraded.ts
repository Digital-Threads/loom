// Degraded markers — the single source of truth for "something silently failed
// on this task" signals (cost not recorded, journal not snapshotted, MCP not
// loaded, token-pilot enforcement missing). Shared so every engine (the api.ts
// dialog-send path and the L4 autonomous run path) writes the SAME artifact
// kind/shape, and so the dossier + task card read one consistent record.
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createArtifact, latestArtifact } from "./artifacts.js";

export const DEGRADED_KIND = "degraded";

/** The de-duped list of degradation reasons recorded for a task ([] when healthy). */
export function degradedReasons(db: Database.Database, taskId: string): string[] {
  const a = latestArtifact(db, taskId, DEGRADED_KIND);
  if (!a) return [];
  try { return (JSON.parse(a.content) as { reasons?: string[] }).reasons ?? []; } catch { return []; }
}

/** Record that something silently degraded for this task. Accumulates a de-duped
 *  list so multiple degradations all show; surfaced on the task card + dossier.
 *  Best-effort: the visibility mechanism must never itself throw. */
export function markDegraded(db: Database.Database, taskId: string, what: string): void {
  try {
    const reasons = degradedReasons(db, taskId);
    if (reasons.includes(what)) return; // already noted → don't accumulate duplicates
    createArtifact(db, {
      id: `art_${randomUUID().slice(0, 8)}`,
      taskId,
      stage: "system",
      kind: DEGRADED_KIND,
      content: JSON.stringify({ reasons: [...reasons, what] }),
      status: "accepted",
    });
  } catch { /* best-effort */ }
}
