// Normalize each layer's raw data into the unified LoomEvent stream, keyed by
// the spine ids. This is the canonical producer for the event bus / timeline:
// one chronological view across token-pilot, task-journal and aimux.

import type { WorkspaceData } from "../data/loader.js";
import { makeEvent, type LoomEvent } from "./event.js";

/** Project all loaded layer data into a single, ts-sorted LoomEvent[]. */
export function toLoomEvents(data: WorkspaceData): LoomEvent[] {
  const projectId = data.projectId;
  const out: LoomEvent[] = [];

  for (const t of data.tokenEvents) {
    out.push(
      makeEvent({
        ts: t.ts,
        source: "token-pilot",
        projectId,
        taskId: t.taskId ?? undefined,
        type: "tokens",
        metrics: { used: t.used, saved: t.saved },
      }),
    );
  }

  for (const e of data.taskEvents) {
    const ts = Date.parse(e.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push(
      makeEvent({
        ts,
        source: "task-journal",
        projectId,
        taskId: e.task_id,
        type: e.type,
        message: e.text,
      }),
    );
  }

  for (const s of data.sessions) {
    if (typeof s.lastUsedAtMs !== "number") continue;
    out.push(
      makeEvent({
        ts: s.lastUsedAtMs,
        source: "aimux",
        projectId,
        profileId: s.profile,
        type: "session",
        message: s.profile,
      }),
    );
  }

  return out.sort((a, b) => a.ts - b.ts);
}
