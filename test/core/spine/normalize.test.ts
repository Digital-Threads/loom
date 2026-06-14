import { describe, it, expect } from "vitest";
import { toLoomEvents } from "../../../src/core/spine/normalize.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function data(partial: Partial<WorkspaceData>): WorkspaceData {
  return {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
    projectId: "p1",
    ...partial,
  } as WorkspaceData;
}

describe("spine/normalize toLoomEvents", () => {
  it("maps token / task / session sources to LoomEvents, ts-sorted", () => {
    const events = toLoomEvents(
      data({
        tokenEvents: [
          { sessionId: "s1", used: 100, saved: 40, ts: 30, agentType: null, taskId: "tj-1" },
        ],
        taskEvents: [
          { event_id: "e1", task_id: "tj-1", type: "decision", timestamp: "2026-06-07T00:00:00.000Z", text: "go" },
        ],
        sessions: [{ sessionId: "s1", profile: "work", lastUsedAtMs: 10 } as never],
      }),
    );

    // session ts=10 first, token ts=30 next, task ts=big last
    expect(events.map((e) => e.source)).toEqual(["aimux", "token-pilot", "task-journal"]);
    const tok = events.find((e) => e.source === "token-pilot")!;
    expect(tok).toMatchObject({
      schema: "loom.event.v1",
      projectId: "p1",
      taskId: "tj-1",
      type: "tokens",
      metrics: { used: 100, saved: 40 },
    });
    expect(events.find((e) => e.source === "task-journal")).toMatchObject({
      taskId: "tj-1",
      type: "decision",
      message: "go",
    });
    expect(events.find((e) => e.source === "aimux")).toMatchObject({
      profileId: "work",
      type: "session",
    });
  });

  it("skips task events with an unparseable timestamp", () => {
    const events = toLoomEvents(
      data({
        taskEvents: [
          { event_id: "e1", task_id: "tj-1", type: "open", timestamp: "not-a-date", text: "" },
        ],
      }),
    );
    expect(events).toEqual([]);
  });

  it("omits taskId for untagged token events", () => {
    const events = toLoomEvents(
      data({ tokenEvents: [{ sessionId: "s1", used: 5, saved: 1, ts: 1, agentType: null }] }),
    );
    expect(events[0].taskId).toBeUndefined();
  });
});
