import type { TokenEvent } from "../plugins/token-pilot/adapter.js";
import type { TjEvent } from "../plugins/task-journal/adapter.js";
import type { SessionRow } from "../plugins/aimux/adapter.js";
import type { WorkspaceData } from "../data/loader.js";

export type TimelineSource = "token-pilot" | "task-journal" | "aimux";
export type TsAccuracy = "exact" | "ingest";

export interface TimelineEntry {
  ts: number;
  source: TimelineSource;
  type: string;
  text: string;
  tsAccuracy: TsAccuracy;
}

export const DEFAULT_TIMELINE_LIMIT = 200;

export interface BuildTimelineOpts {
  limit?: number;
}

function fromTokenEvents(events: TokenEvent[]): TimelineEntry[] {
  return events.map((e) => ({
    ts: e.ts,
    source: "token-pilot" as const,
    type: "tokens",
    text: `used ${e.used}, saved ${e.saved}`,
    tsAccuracy: "exact" as const,
  }));
}

function fromTaskEvents(events: TjEvent[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const e of events) {
    const ts = Date.parse(e.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push({
      ts,
      source: "task-journal",
      type: e.type,
      text: e.text,
      tsAccuracy: "ingest",
    });
  }
  return out;
}

function fromSessions(sessions: SessionRow[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const s of sessions) {
    if (s.lastUsedAtMs == null) continue;
    out.push({
      ts: s.lastUsedAtMs,
      source: "aimux",
      type: "session",
      text: s.profile,
      tsAccuracy: "exact",
    });
  }
  return out;
}

const SOURCE_ORDER: Record<TimelineSource, number> = {
  "token-pilot": 0,
  aimux: 1,
  "task-journal": 2,
};

export function buildTimeline(data: WorkspaceData, opts: BuildTimelineOpts = {}): TimelineEntry[] {
  const merged: TimelineEntry[] = [
    ...fromTokenEvents(data.tokenEvents),
    ...fromTaskEvents(data.taskEvents),
    ...fromSessions(data.sessions),
  ];

  merged.sort((a, b) => {
    if (b.ts !== a.ts) return b.ts - a.ts;
    if (SOURCE_ORDER[a.source] !== SOURCE_ORDER[b.source]) {
      return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
    }
    return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
  });

  const limit = opts.limit ?? DEFAULT_TIMELINE_LIMIT;
  if (limit === Infinity) return merged;
  return merged.slice(0, limit);
}
