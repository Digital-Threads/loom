import { describe, it, expect } from "vitest";
import {
  tasksFromEvents,
  taskDetailFromEvents,
  type TjEvent,
} from "../../../../src/core/plugins/task-journal/adapter.js";

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

const events: TjEvent[] = [
  // tj-a: open (with title) + decision + finding + rejection → open, "Task A"
  ev({ task_id: "tj-a", type: "open", timestamp: "2026-06-07T09:00:00.000Z", meta: { title: "Task A" }, text: "started A" }),
  ev({ task_id: "tj-a", type: "decision", timestamp: "2026-06-07T09:01:00.000Z", text: "use X" }),
  ev({ task_id: "tj-a", type: "finding", timestamp: "2026-06-07T09:02:00.000Z", text: "found Y" }),
  ev({ task_id: "tj-a", type: "rejection", timestamp: "2026-06-07T09:03:00.000Z", text: "not Z" }),

  // tj-b: open (no title, text="Bee") + close → "Bee", closed
  ev({ task_id: "tj-b", type: "open", timestamp: "2026-06-07T08:00:00.000Z", text: "Bee" }),
  ev({ task_id: "tj-b", type: "close", timestamp: "2026-06-07T08:30:00.000Z", text: "done" }),

  // tj-c: open + close + later reopen (reopen > close) → open
  ev({ task_id: "tj-c", type: "open", timestamp: "2026-06-07T07:00:00.000Z", meta: { title: "Task C" } }),
  ev({ task_id: "tj-c", type: "close", timestamp: "2026-06-07T07:30:00.000Z" }),
  ev({ task_id: "tj-c", type: "reopen", timestamp: "2026-06-07T10:00:00.000Z" }),
];

describe("task-journal adapter — tasksFromEvents", () => {
  it("reconstructs all 3 tasks", () => {
    expect(tasksFromEvents(events)).toHaveLength(3);
  });

  it("derives title and status correctly", () => {
    const tasks = tasksFromEvents(events);
    const byId = (id: string) => tasks.find((t) => t.id === id)!;

    expect(byId("tj-a")).toEqual({ id: "tj-a", title: "Task A", status: "open" });
    expect(byId("tj-b")).toEqual({ id: "tj-b", title: "Bee", status: "closed" });
    expect(byId("tj-c")).toEqual({ id: "tj-c", title: "Task C", status: "open" });
  });

  it("sorts by most-recent event timestamp descending", () => {
    // latest events: tj-c reopen 10:00, tj-a rejection 09:03, tj-b close 08:30
    const ids = tasksFromEvents(events).map((t) => t.id);
    expect(ids).toEqual(["tj-c", "tj-a", "tj-b"]);
  });
});

describe("task-journal adapter — taskDetailFromEvents", () => {
  it("buckets decisions/findings/rejections for tj-a", () => {
    const detail = taskDetailFromEvents(events, "tj-a");
    expect(detail.decisions).toHaveLength(1);
    expect(detail.findings).toHaveLength(1);
    expect(detail.rejections).toHaveLength(1);
    expect(detail.decisions[0].text).toBe("use X");
    expect(detail.findings[0].text).toBe("found Y");
    expect(detail.rejections[0].text).toBe("not Z");
  });

  it("preserves chronological (ascending) order within a bucket", () => {
    const multi: TjEvent[] = [
      ev({ task_id: "tj-x", type: "decision", timestamp: "2026-06-07T09:05:00.000Z", text: "second" }),
      ev({ task_id: "tj-x", type: "decision", timestamp: "2026-06-07T09:01:00.000Z", text: "first" }),
    ];
    const detail = taskDetailFromEvents(multi, "tj-x");
    expect(detail.decisions.map((d) => d.text)).toEqual(["first", "second"]);
  });

  it("returns empty buckets for a missing task id", () => {
    expect(taskDetailFromEvents(events, "missing")).toEqual({
      decisions: [],
      findings: [],
      rejections: [],
    });
  });
});
