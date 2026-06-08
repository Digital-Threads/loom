import { describe, it, expect } from "vitest";
import { relatedSessions } from "../../../src/core/metrics/related-sessions.js";
import type { TjEvent } from "../../../src/core/plugins/task-journal/adapter.js";
import type { SessionRow } from "../../../src/core/plugins/aimux/adapter.js";
import type { TokenUsageRow } from "../../../src/core/plugins/token-pilot/adapter.js";

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

const events: TjEvent[] = [
  ev({ task_id: "tj-x", type: "open", timestamp: WINDOW_START, meta: { title: "Task X" } }),
  ev({ task_id: "tj-x", type: "finding", timestamp: "2026-06-07T11:00:00.000Z", text: "mid" }),
  ev({ task_id: "tj-x", type: "close", timestamp: WINDOW_END, text: "done" }),
  // noise from another task — must not affect tj-x window
  ev({ task_id: "tj-other", type: "open", timestamp: "2026-06-07T05:00:00.000Z" }),
];

// Session lastUsedAtMs derived from the same RFC3339 instants the window is based on.
const ms = (rfc: string) => Date.parse(rfc);

const sessions: SessionRow[] = [
  { sessionId: "s-in-aaaa1111", profile: "claude", lastUsedAtMs: ms("2026-06-07T11:00:00.000Z") }, // inside
  { sessionId: "s-before-bbbb", profile: "claude", lastUsedAtMs: ms("2026-06-07T09:00:00.000Z") }, // before
  { sessionId: "s-after-cccc", profile: "claude", lastUsedAtMs: ms("2026-06-07T13:00:00.000Z") }, // after
  { sessionId: "s-nots-dddd", profile: "claude", lastUsedAtMs: undefined }, // no timestamp
  { sessionId: "s-notok-eeee", profile: "gpt", lastUsedAtMs: ms("2026-06-07T11:30:00.000Z") }, // inside, no token row
];

const tokens: TokenUsageRow[] = [
  { sessionId: "s-in-aaaa1111", used: 1000, saved: 250 },
  { sessionId: "s-before-bbbb", used: 999, saved: 999 },
];

describe("relatedSessions — heuristic timeline correlation", () => {
  it("includes only sessions whose lastUsedAtMs falls within the task window", () => {
    const result = relatedSessions(events, "tj-x", sessions, tokens);
    const ids = result.map((r) => r.sessionId);
    expect(ids).toContain("s-in-aaaa1111");
    expect(ids).toContain("s-notok-eeee");
    expect(ids).not.toContain("s-before-bbbb");
    expect(ids).not.toContain("s-after-cccc");
    expect(ids).not.toContain("s-nots-dddd");
    expect(result).toHaveLength(2);
  });

  it("enriches with the matching token row", () => {
    const result = relatedSessions(events, "tj-x", sessions, tokens);
    const sIn = result.find((r) => r.sessionId === "s-in-aaaa1111")!;
    expect(sIn).toEqual({
      sessionId: "s-in-aaaa1111",
      profile: "claude",
      lastUsedAtMs: ms("2026-06-07T11:00:00.000Z"),
      used: 1000,
      saved: 250,
    });
  });

  it("defaults used/saved to 0 when no token row exists", () => {
    const result = relatedSessions(events, "tj-x", sessions, tokens);
    const sNoTok = result.find((r) => r.sessionId === "s-notok-eeee")!;
    expect(sNoTok.used).toBe(0);
    expect(sNoTok.saved).toBe(0);
    expect(sNoTok.profile).toBe("gpt");
  });

  it("sorts descending by lastUsedAtMs (most recent first)", () => {
    const result = relatedSessions(events, "tj-x", sessions, tokens);
    expect(result.map((r) => r.sessionId)).toEqual(["s-notok-eeee", "s-in-aaaa1111"]);
  });

  it("returns [] for a task with no events", () => {
    expect(relatedSessions(events, "missing-task", sessions, tokens)).toEqual([]);
  });
});
