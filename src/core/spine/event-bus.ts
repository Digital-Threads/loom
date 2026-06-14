// Append-only event bus: one JSONL file per project under the Loom data dir.
// Loom writes its own events here and (later) normalizes plugin sources into it,
// giving a single chronological spine keyed by the shared ids. Best-effort —
// telemetry must never throw into a caller.

import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { loomDataDir } from "../paths.js";
import type { LoomEvent } from "./event.js";

export function eventLogPath(projectId: string): string {
  return join(loomDataDir(), "events", `${projectId}.jsonl`);
}

export function appendLoomEvent(projectId: string, event: LoomEvent): void {
  try {
    const path = eventLogPath(projectId);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(event) + "\n");
  } catch {
    /* best-effort: never break the caller on telemetry */
  }
}

export function loadLoomEvents(projectId: string): LoomEvent[] {
  const path = eventLogPath(projectId);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: LoomEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as LoomEvent);
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}
