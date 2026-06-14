// The spine: the four shared ids that tie accounts (aimux), tokens (token-pilot),
// memory (task-journal) and runs together, plus the env contract that carries
// them into a Loom-launched session.
//
// aimux's runProfileHeadless writes these env vars on the spawned process;
// token-pilot stamps task_id/workflow_id onto its hook events from them, and
// task-journal can pick them up too. Keeping the names in one place here makes
// that contract a single source of truth.

import { randomBytes } from "node:crypto";
import { deriveProjectId, resolveProjectRoot } from "../workspace/project-id.js";

export { deriveProjectId, resolveProjectRoot } from "../workspace/project-id.js";

/** Env var names that carry the spine into a session. Must match what the
 *  plugins read (token-pilot: LOOM_TASK_ID / LOOM_WORKFLOW_ID). */
export const SPINE_ENV = {
  projectId: "LOOM_PROJECT_ID",
  profileId: "LOOM_PROFILE_ID",
  taskId: "LOOM_TASK_ID",
  workflowId: "LOOM_WORKFLOW_ID",
} as const;

/** The four shared ids. Only projectId is always known; the rest depend on
 *  what the current run is bound to. */
export interface SpineIds {
  projectId: string;
  profileId?: string;
  taskId?: string;
  workflowId?: string;
}

/** Read whatever spine ids are present in an env bag (defaults to process.env). */
export function readSpineIds(env: NodeJS.ProcessEnv = process.env): Partial<SpineIds> {
  const ids: Partial<SpineIds> = {};
  const p = env[SPINE_ENV.projectId];
  const pr = env[SPINE_ENV.profileId];
  const t = env[SPINE_ENV.taskId];
  const w = env[SPINE_ENV.workflowId];
  if (p) ids.projectId = p;
  if (pr) ids.profileId = pr;
  if (t) ids.taskId = t;
  if (w) ids.workflowId = w;
  return ids;
}

/** Build the env bag to inject into a session for the given spine ids. Omits
 *  absent optional ids so nothing unset leaks into the child env. */
export function spineEnv(ids: SpineIds): Record<string, string> {
  const env: Record<string, string> = { [SPINE_ENV.projectId]: ids.projectId };
  if (ids.profileId) env[SPINE_ENV.profileId] = ids.profileId;
  if (ids.taskId) env[SPINE_ENV.taskId] = ids.taskId;
  if (ids.workflowId) env[SPINE_ENV.workflowId] = ids.workflowId;
  return env;
}

/** A fresh run id. We mint it — token-pilot just echoes LOOM_WORKFLOW_ID onto
 *  its hook events — so any unique value works; `wf_<16 hex>` is the convention. */
export function newWorkflowId(): string {
  return `wf_${randomBytes(8).toString("hex")}`;
}

export interface BuildSpineInput {
  repoRoot: string;          // the run's target repo (project root is derived from it)
  profileId?: string;        // chosen aimux subscription (from the router)
  taskId?: string;           // task-journal task id, shared since Creation
  workflowId?: string;       // explicit run id; minted when absent
}

/** Assemble the spine ids for a run: derive projectId from the repo root (the
 *  task-journal-aligned algorithm), carry the chosen profile/task, and mint a
 *  workflowId if none was supplied. Feed the result to `spineEnv` to inject. */
export function buildSpineIds(input: BuildSpineInput): SpineIds {
  return {
    projectId: deriveProjectId(resolveProjectRoot(input.repoRoot)),
    profileId: input.profileId,
    taskId: input.taskId,
    workflowId: input.workflowId ?? newWorkflowId(),
  };
}
