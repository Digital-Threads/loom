// L7.2 — semantic search over THIS project's memory via `task-journal ask --json`
// (Pillar A). Distinct from recall (cross-project). Defensive: failure → [].
import { execFileSync } from "node:child_process";
import { parseRecall, type RecallHit } from "./index.js";

export type AskRunner = (query: string, k: number, projectRoot: string) => string;

const defaultRunner: AskRunner = (query, k, projectRoot) =>
  execFileSync("task-journal", ["ask", query, "--json", "--k", String(k)], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

export interface AskOptions {
  k?: number;
  run?: AskRunner;
}

export function askSearch(projectRoot: string, query: string, opts: AskOptions = {}): RecallHit[] {
  const run = opts.run ?? defaultRunner;
  try {
    return parseRecall(run(query, opts.k ?? 5, projectRoot));
  } catch {
    return [];
  }
}
