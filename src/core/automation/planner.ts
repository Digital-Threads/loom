// Planner — turns a spec into a step DAG and persists it to the store.
// The decomposition itself is an LLM call, injected as a Decomposer so the
// planning logic is testable without a model; the agent-backed decomposer
// parses the model's JSON output via parsePlan.

import type Database from "better-sqlite3";
import { createStep, getSteps, type StepRow } from "../store/steps.js";

export interface StepSpec {
  id: string;
  title: string;
  approach?: string;
  files?: string[];
  dependsOn?: string[];
}

export interface Decomposer {
  decompose(spec: string): Promise<StepSpec[]>;
}

/** Persist a decomposed plan as step rows for the task; return the stored steps. */
export async function planTask(
  db: Database.Database,
  decomposer: Decomposer,
  taskId: string,
  spec: string,
): Promise<StepRow[]> {
  const specs = await decomposer.decompose(spec);
  for (const s of specs) {
    createStep(db, {
      id: s.id,
      taskId,
      title: s.title,
      approach: s.approach,
      files: s.files,
      dependsOn: s.dependsOn,
    });
  }
  return getSteps(db, taskId);
}

/**
 * Parse a decomposer model response into StepSpec[]. Defensive: the model may
 * wrap the JSON array in prose or code fences, and individual entries may be
 * malformed — those are dropped rather than throwing.
 */
export function parsePlan(text: string): StepSpec[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: StepSpec[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || typeof s.title !== "string") continue;
    out.push({
      id: s.id,
      title: s.title,
      approach: typeof s.approach === "string" ? s.approach : undefined,
      files: Array.isArray(s.files) ? s.files.filter((f): f is string => typeof f === "string") : undefined,
      dependsOn: Array.isArray(s.dependsOn)
        ? s.dependsOn.filter((d): d is string => typeof d === "string")
        : undefined,
    });
  }
  return out;
}

/** The planning prompt handed to the decomposer agent. */
export function planPrompt(spec: string): string {
  return [
    "Decompose this software task into a minimal DAG of implementation steps.",
    "Return ONLY a JSON array; each item: { id, title, approach?, files?, dependsOn? }.",
    "ids are short slugs; dependsOn references other ids. No prose.",
    "",
    "TASK:",
    spec,
  ].join("\n");
}
