// L13.x — agent self-steering. The agent that runs a stage can decide the task
// belongs at a DIFFERENT stage and say so in its output with a directive:
//
//   LOOM-RELOCATE: <stage> | <reason>
//
// e.g. a reviewer that finds the work was never properly analysed emits
//   LOOM-RELOCATE: analysis | spec missed the concurrency requirement entirely
// and Loom sends the task back to `analysis` instead of looping on fixes.
//
// This module is the PURE parsing + guard layer (the conductor applies the move).
// Guards: unknown stage / empty reason → ignored; a per-task budget caps how many
// times a task may self-relocate, so the agent can't ping-pong it forever.

import { STAGE_KEYS } from "../store/db.js";

export const RELOCATE_MARKER = "LOOM-RELOCATE:";
/** Max self-relocations per task — a loop guard. Beyond it, directives are ignored. */
export const RELOCATE_BUDGET = 3;

export interface Relocate {
  stage: string;
  reason: string;
}

/**
 * Parse a `LOOM-RELOCATE: <stage> | <reason>` directive from agent output.
 * Returns null when absent or invalid (unknown stage / empty reason) — a
 * malformed directive is ignored, never acted on.
 */
export function parseRelocate(text: string): Relocate | null {
  const m = text.match(/^[ \t>*-]*LOOM-RELOCATE:\s*([A-Za-z]+)\s*\|\s*(.+?)\s*$/m);
  if (!m) return null;
  const stage = m[1].toLowerCase();
  const reason = m[2].trim();
  if (!reason) return null;
  if (!(STAGE_KEYS as readonly string[]).includes(stage)) return null;
  return { stage, reason };
}

/** Whether a self-relocation is still within the per-task budget. */
export function relocateAllowed(count: number, budget: number = RELOCATE_BUDGET): boolean {
  return count < budget;
}
