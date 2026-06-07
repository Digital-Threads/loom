import { describe, it, expect } from "vitest";
import { tokensBySessionForTask } from "../../../src/core/metrics/tokens-per-task.js";
import type { TjEvent } from "@digital-threads/loom-plugin-task-journal";
import type { TokenEvent } from "@digital-threads/loom-plugin-token-pilot";
import type { SessionRow } from "@digital-threads/loom-plugin-aimux";

function ev(partial: Partial<TjEvent> & Pick<TjEvent, "task_id" | "type" | "timestamp">): TjEvent {
  return {
    event_id: partial.event_id ?? `e-${partial.task_id}-${partial.type}-${partial.timestamp}`,
    task_id: partial.task_id,
    type: partial.type,
    timestamp: partial.timestamp,
    text: partial.text ?? "",
    meta: partial.meta,
  };
}

// Window for tj-x: 10:00 .. 12:00 on 2026-06-07
const WINDOW_START = "2026-06-07T10:00:00.000Z";
const WINDOW_END = "2026-06-07T12:00:00.000Z";
const ms = (rfc: string) => Date.parse(rfc);
const START_MS = ms(WINDOW_START);
const END_MS = ms(WINDOW_END);

const events: TjEvent[] = [
  ev({ task_id: "tj-x", type: "open", timestamp: WINDOW_START, meta: { title: "Task X" } }),
  ev({ task_id: "tj-x", type: "finding", timestamp: "2026-06-07T11:00:00.000Z", text: "mid" }),
  ev({ task_id: "tj-x", type: "close", timestamp: WINDOW_END, text: "done" }),
  ev({ task_id: "tj-other", type: "open", timestamp: "2026-06-07T05:00:00.000Z" }),
];

function tk(sessionId: string, ts: number, used: number, saved: number): TokenEvent {
  return { sessionId, used, saved, ts };
}

function sess(sessionId: string, profile: string): SessionRow {
  return { sessionId, profile };
}

describe("tokensBySessionForTask — per-session/profile breakdown", () => {
  it("groups in-window tokens by session, joins profiles, sorts by used desc", () => {
    const tokenEvents: TokenEvent[] = [
      tk("s1", ms("2026-06-07T10:30:00.000Z"), 100, 10),
      tk("s1", ms("2026-06-07T11:00:00.000Z"), 200, 20),
      tk("s2", ms("2026-06-07T11:45:00.000Z"), 500, 5),
    ];
    const sessions: SessionRow[] = [sess("s1", "alpha"), sess("s2", "beta")];
    expect(tokensBySessionForTask(events, "tj-x", tokenEvents, sessions)).toEqual([
      { sessionId: "s2", profile: "beta", used: 500, saved: 5 },
      { sessionId: "s1", profile: "alpha", used: 300, saved: 30 },
    ]);
  });

  it("excludes token events outside the task window", () => {
    const tokenEvents: TokenEvent[] = [
      tk("s1", START_MS - 1, 999, 999), // before
      tk("s1", ms("2026-06-07T11:00:00.000Z"), 100, 10), // inside
      tk("s1", END_MS + 1, 888, 888), // after
    ];
    const sessions: SessionRow[] = [sess("s1", "alpha")];
    expect(tokensBySessionForTask(events, "tj-x", tokenEvents, sessions)).toEqual([
      { sessionId: "s1", profile: "alpha", used: 100, saved: 10 },
    ]);
  });

  it("uses profile '—' when session id is absent from sessions", () => {
    const tokenEvents: TokenEvent[] = [tk("ghost", ms("2026-06-07T11:00:00.000Z"), 42, 4)];
    const sessions: SessionRow[] = [sess("s1", "alpha")];
    expect(tokensBySessionForTask(events, "tj-x", tokenEvents, sessions)).toEqual([
      { sessionId: "ghost", profile: "—", used: 42, saved: 4 },
    ]);
  });

  it("returns [] for an unknown taskId / no task events", () => {
    const tokenEvents: TokenEvent[] = [tk("s1", ms("2026-06-07T11:00:00.000Z"), 100, 10)];
    const sessions: SessionRow[] = [sess("s1", "alpha")];
    expect(tokensBySessionForTask(events, "missing-task", tokenEvents, sessions)).toEqual([]);
  });
});
