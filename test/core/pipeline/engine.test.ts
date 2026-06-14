import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getStages } from "../../../src/core/store/db.js";
import {
  startTask,
  completeStage,
  currentStage,
  boardColumns,
  attentionQueue,
} from "../../../src/core/pipeline/engine.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-pipe-"));
  db = openStore(join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("pipeline engine", () => {
  it("startTask activates the first route stage and sets task running", () => {
    createTask(db, { id: "t1", title: "Refund" });
    expect(startTask(db, "t1")).toBe("analysis");
    const cur = currentStage(getStages(db, "t1"))!;
    expect(cur.stage_key).toBe("analysis");
    expect(cur.status).toBe("active");
  });

  it("completeStage advances to the next pending stage", () => {
    createTask(db, { id: "t2", title: "Refund" });
    startTask(db, "t2");
    expect(completeStage(db, "t2", "analysis")).toBe("brainstorm");
    expect(currentStage(getStages(db, "t2"))!.stage_key).toBe("brainstorm");
  });

  it("completeStage skips over skipped stages (bugfix route)", () => {
    createTask(db, { id: "t3", title: "Fix typo", route: ["analysis", "impl", "review", "pr", "done"] });
    startTask(db, "t3");
    // analysis → next pending is impl (brainstorm/spec/rd are skipped)
    expect(completeStage(db, "t3", "analysis")).toBe("impl");
  });

  it("completeStage returns null and marks task done at the end", () => {
    createTask(db, { id: "t4", title: "X", route: ["analysis", "done"] });
    startTask(db, "t4");
    completeStage(db, "t4", "analysis"); // → done stage active
    expect(completeStage(db, "t4", "done")).toBeNull();
    expect(currentStage(getStages(db, "t4"))).toBeUndefined();
  });

  it("boardColumns places each task in its current stage column", () => {
    createTask(db, { id: "a", title: "A" });
    createTask(db, { id: "b", title: "B" });
    startTask(db, "a");
    startTask(db, "b");
    completeStage(db, "b", "analysis"); // b → brainstorm
    const cols = boardColumns(db);
    expect(cols).toHaveLength(9);
    expect(cols.find((c) => c.stageKey === "analysis")!.cards.map((c) => c.id)).toEqual(["a"]);
    expect(cols.find((c) => c.stageKey === "brainstorm")!.cards.map((c) => c.id)).toEqual(["b"]);
  });

  it("attentionQueue lists tasks parked at an active gated stage", () => {
    createTask(db, { id: "g", title: "Gated" }); // default gate=1 on all route stages
    startTask(db, "g"); // analysis active, gate 1 → needs attention
    const q = attentionQueue(db);
    expect(q).toEqual([{ taskId: "g", title: "Gated", stageKey: "analysis" }]);
  });

  it("attentionQueue excludes ungated active stages", () => {
    createTask(db, { id: "u", title: "Ungated", run_mode: "autopilot" });
    // simulate autopilot: clear the gate on analysis
    db.prepare("UPDATE stages SET gate = 0 WHERE task_id = 'u' AND stage_key = 'analysis'").run();
    startTask(db, "u");
    expect(attentionQueue(db)).toEqual([]);
  });
});
