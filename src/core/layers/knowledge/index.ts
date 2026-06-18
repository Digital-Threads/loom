// Loom knowledge layer — recall prior reasoning (decisions/rejections) from
// task-journal. Standalone (its own CLI/lib/tests) AND embeddable in Loom via
// the host adapter. Thin wrapper over `task-journal recall --json`.
import { execFileSync } from "node:child_process";

export interface RecallHit {
  taskId: string;
  projectHash: string;
  eventType: string;
  text: string;
  score: number;
}

/** Runs the recall CLI and returns raw stdout. Injectable for tests. */
export type RecallRunner = (query: string, limit: number, projectRoot: string) => string;

const defaultRunner: RecallRunner = (query, limit, projectRoot) =>
  execFileSync("task-journal", ["recall", query, "--json", "--limit", String(limit)], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

export interface RecallOptions {
  limit?: number;
  run?: RecallRunner;
}

/** Recall prior reasoning relevant to `query`. Defensive: any failure yields []. */
export function recallPrior(projectRoot: string, query: string, opts: RecallOptions = {}): RecallHit[] {
  const run = opts.run ?? defaultRunner;
  const limit = opts.limit ?? 5;
  let raw: string;
  try {
    raw = run(query, limit, projectRoot);
  } catch {
    return [];
  }
  return parseRecall(raw);
}

/** Parse the recall --json output defensively into RecallHit[]. */
export function parseRecall(json: string): RecallHit[] {
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: RecallHit[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const h = raw as Record<string, unknown>;
    if (typeof h.task_id !== "string" || typeof h.text !== "string") continue;
    out.push({
      taskId: h.task_id,
      projectHash: typeof h.project_hash === "string" ? h.project_hash : "",
      eventType: typeof h.event_type === "string" ? h.event_type : "",
      text: h.text,
      score: typeof h.score === "number" ? h.score : 0,
    });
  }
  return out;
}

/** Split hits into "already rejected" vs "prior decisions" for UI warnings. */
export function partitionHits(hits: RecallHit[]): { rejections: RecallHit[]; decisions: RecallHit[] } {
  return {
    rejections: hits.filter((h) => h.eventType === "rejection"),
    decisions: hits.filter((h) => h.eventType === "decision"),
  };
}
export * from "./graph.js";
export * from "./ask.js";
