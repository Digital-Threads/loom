import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import { getCosts } from "../../../src/core/store/execute.js";
import { taskRollup, boardTotals, rollupToStore } from "../../../src/core/observability/metrics.js";
import { makeEvent, type LoomEvent } from "../../../src/core/spine/event.js";
import type Database from "better-sqlite3";

function tok(taskId: string | undefined, ts: number, used: number, saved: number): LoomEvent {
  return makeEvent({ ts, source: "token-pilot", projectId: "p1", taskId, type: "tokens", metrics: { used, saved } });
}
function tj(taskId: string, ts: number): LoomEvent {
  return makeEvent({ ts, source: "task-journal", projectId: "p1", taskId, type: "decision", message: "x" });
}

describe("taskRollup", () => {
  const events: LoomEvent[] = [
    tj("tj-1", 100),
    tok("tj-1", 200, 50, 20),
    tok("tj-1", 400, 30, 10),
    tok("tj-2", 300, 999, 999), // other task — ignored
  ];

  it("sums token used/saved and computes the time window for one task", () => {
    expect(taskRollup(events, "tj-1")).toEqual({
      taskId: "tj-1",
      events: 3,
      used: 80,
      saved: 30,
      firstTs: 100,
      lastTs: 400,
      durationMs: 300,
    });
  });

  it("returns zeros/nulls for an unknown task", () => {
    expect(taskRollup(events, "missing")).toMatchObject({ events: 0, used: 0, saved: 0, firstTs: null, durationMs: 0 });
  });
});

describe("boardTotals", () => {
  it("sums token metrics across all events", () => {
    const events = [tok("tj-1", 1, 10, 4), tok("tj-2", 2, 5, 1), tj("tj-1", 3)];
    expect(boardTotals(events)).toEqual({ used: 15, saved: 5, events: 3 });
  });
});

describe("rollupToStore", () => {
  let dir: string;
  let db: Database.Database;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loom-obs-"));
    db = openStore(join(dir, "test.db"));
    createTask(db, { id: "tj-1", title: "T" });
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes saved + used cost rows with the exact flag", () => {
    rollupToStore(db, taskRollup([tok("tj-1", 1, 80, 30)], "tj-1"), true);
    const costs = getCosts(db, "tj-1");
    const saved = costs.find((c) => c.metric === "saved")!;
    const used = costs.find((c) => c.metric === "used")!;
    expect(saved).toMatchObject({ source: "token-pilot", value: 30, exact: 1 });
    expect(used).toMatchObject({ value: 80, exact: 1 });
  });
});
