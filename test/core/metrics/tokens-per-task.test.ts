import { describe, it, expect } from "vitest";
import { tokensForTask } from "../../../src/core/metrics/tokens-per-task.js";
import type { TjEvent } from "@digital-threads/loom-plugin-task-journal";
import type { TokenEvent } from "@digital-threads/loom-plugin-token-pilot";

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
  // noise from another task — must not affect tj-x window
  ev({ task_id: "tj-other", type: "open", timestamp: "2026-06-07T05:00:00.000Z" }),
];

function tk(sessionId: string, ts: number, used: number, saved: number): TokenEvent {
  return { sessionId, used, saved, ts };
}

describe("tokensForTask — token correlation by task window", () => {
  it("sums tokens of events inside the task window", () => {
    const tokenEvents: TokenEvent[] = [
      tk("s1", ms("2026-06-07T10:30:00.000Z"), 100, 10),
      tk("s1", ms("2026-06-07T11:00:00.000Z"), 200, 20),
      tk("s2", ms("2026-06-07T11:45:00.000Z"), 50, 5),
    ];
    expect(tokensForTask(events, "tj-x", tokenEvents)).toEqual({ used: 350, saved: 35 });
  });

  it("excludes token events before window-start and after window-end", () => {
    const tokenEvents: TokenEvent[] = [
      tk("s1", START_MS - 1, 999, 999), // just before
      tk("s1", ms("2026-06-07T11:00:00.000Z"), 100, 10), // inside
      tk("s1", END_MS + 1, 888, 888), // just after
    ];
    expect(tokensForTask(events, "tj-x", tokenEvents)).toEqual({ used: 100, saved: 10 });
  });

  it("includes boundary events at ts == startMs and ts == endMs", () => {
    const tokenEvents: TokenEvent[] = [
      tk("s1", START_MS, 100, 10),
      tk("s1", END_MS, 200, 20),
    ];
    expect(tokensForTask(events, "tj-x", tokenEvents)).toEqual({ used: 300, saved: 30 });
  });

  it("returns {used:0,saved:0} for an unknown taskId / no task events", () => {
    const tokenEvents: TokenEvent[] = [tk("s1", ms("2026-06-07T11:00:00.000Z"), 100, 10)];
    expect(tokensForTask(events, "missing-task", tokenEvents)).toEqual({ used: 0, saved: 0 });
  });

  it("returns {used:0,saved:0} for empty tokenEvents", () => {
    expect(tokensForTask(events, "tj-x", [])).toEqual({ used: 0, saved: 0 });
  });
});
