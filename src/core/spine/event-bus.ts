// Append-only event bus: one JSONL file per project under the Loom data dir.
// Loom writes its own events here and (later) normalizes plugin sources into it,
// giving a single chronological spine keyed by the shared ids. Best-effort —
// telemetry must never throw into a caller.

import { appendFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
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

/** Load blocked-command audit entries written by the command-policy hook and
 *  convert them to `audit.command.blocked` LoomEvents for the timeline. */
export function loadCommandAuditEvents(projectId: string): LoomEvent[] {
  const dir = join(loomDataDir(), "audit");
  if (!existsSync(dir)) return [];
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")); }
  catch { return []; }
  const out: LoomEvent[] = [];
  for (const file of files) {
    let raw: string;
    try { raw = readFileSync(join(dir, file), "utf8"); }
    catch { continue; }
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t) as { ts: number; taskId: string; projectId: string; command: string; reason: string };
        if (e.projectId !== projectId) continue;
        out.push({
          schema: "loom.event.v1",
          ts: e.ts,
          source: "loom",
          projectId: e.projectId,
          taskId: e.taskId,
          type: "audit.command.blocked",
          severity: "warn",
          message: `Blocked: ${e.command.slice(0, 120)} — ${e.reason}`,
        });
      } catch { /* skip corrupt line */ }
    }
  }
  return out;
}
