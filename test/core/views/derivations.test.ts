import { describe, it, expect } from "vitest";
import {
  sessionsWithTokens,
  tokenTotals,
  taskTitle,
  derivations,
} from "../../../src/core/views/derivations.js";
import { tokensForTask } from "../../../src/core/metrics/tokens-per-task.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";
import type { TjEvent } from "../../../src/core/plugins/task-journal/adapter.js";

function makeData(over: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
    ...over,
  } as WorkspaceData;
}

function ev(p: Pick<TjEvent, "task_id" | "type" | "timestamp"> & Partial<TjEvent>): TjEvent {
  return {
    event_id: p.event_id ?? `e-${p.task_id}-${p.type}-${p.timestamp}`,
    task_id: p.task_id,
    type: p.type,
    timestamp: p.timestamp,
    text: p.text ?? "",
    meta: p.meta,
  };
}

describe("sessionsWithTokens", () => {
  it("joins sessions with their token row, zeros when missing", () => {
    const data = makeData({
      sessions: [
        { sessionId: "s1", profile: "p1" },
        { sessionId: "s2", profile: "p2" },
      ],
      tokens: [{ sessionId: "s1", used: 100, saved: 10 }],
    });
    expect(sessionsWithTokens(data)).toEqual([
      { sessionId: "s1", profile: "p1", used: 100, saved: 10 },
      { sessionId: "s2", profile: "p2", used: 0, saved: 0 },
    ]);
  });
});

describe("tokenTotals", () => {
  it("sums used and saved across all token rows", () => {
    const data = makeData({
      tokens: [
        { sessionId: "s1", used: 100, saved: 10 },
        { sessionId: "s2", used: 50, saved: 5 },
      ],
    });
    expect(tokenTotals(data)).toEqual({ used: 150, saved: 15 });
  });

  it("returns zeros for empty tokens", () => {
    expect(tokenTotals(makeData())).toEqual({ used: 0, saved: 0 });
  });
});

describe("taskTitle", () => {
  it("returns the matching task title", () => {
    const data = makeData({ tasks: [{ id: "tj-1", title: "Hello", status: "open" }] });
    expect(taskTitle(data, "tj-1")).toBe("Hello");
  });

  it("returns empty string for unknown task", () => {
    expect(taskTitle(makeData(), "missing")).toBe("");
  });
});

describe("derivation wrappers call the real metric functions", () => {
  it("tokensForTask wrapper matches the underlying metric", () => {
    const taskEvents: TjEvent[] = [
      ev({ task_id: "tj-x", type: "open", timestamp: "2026-06-07T10:00:00.000Z" }),
      ev({ task_id: "tj-x", type: "close", timestamp: "2026-06-07T12:00:00.000Z" }),
    ];
    const tokenEvents = [
      { sessionId: "s1", used: 100, saved: 10, ts: Date.parse("2026-06-07T11:00:00.000Z") },
    ];
    const data = makeData({ taskEvents, tokenEvents });
    const viaDerivation = derivations.tokensForTask(data, "tj-x");
    const viaMetric = tokensForTask(taskEvents, "tj-x", tokenEvents);
    expect(viaDerivation).toEqual(viaMetric);
    expect(viaDerivation).toEqual({ used: 100, saved: 10 });
  });

  it("registry exposes the spec-named derivations", () => {
    for (const name of [
      "sessionsWithTokens",
      "tokenTotals",
      "taskTitle",
      "taskDetailFromEvents",
      "tokensForTask",
      "tokensBySessionForTask",
      "relatedSessions",
      "tokenMetricsFromEvents",
    ]) {
      expect(typeof derivations[name]).toBe("function");
    }
  });
});
