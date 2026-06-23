import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getStages, getTask } from "../../../src/core/store/db.js";
import {
  startTask,
  completeStage,
  currentStage,
  boardColumns,
  attentionQueue,
  moveToStage,
  ensureStageInRoute,
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

  it("moveToStage repositions a task to the target column (drag-drop)", () => {
    createTask(db, { id: "m", title: "Move me" });
    startTask(db, "m"); // analysis active
    expect(moveToStage(db, "m", "spec")).toBe("spec");
    const stages = getStages(db, "m");
    const status = (k: string) => stages.find((s) => s.stage_key === k)!.status;
    expect(status("analysis")).toBe("done");
    expect(status("brainstorm")).toBe("done");
    expect(status("spec")).toBe("active");
    expect(status("rd")).toBe("pending");
    // board reflects the move
    expect(boardColumns(db).find((c) => c.stageKey === "spec")!.cards.map((c) => c.id)).toEqual(["m"]);
  });

  it("moveToStage can move a task backwards", () => {
    createTask(db, { id: "b", title: "Back" });
    startTask(db, "b");
    moveToStage(db, "b", "qa");
    expect(moveToStage(db, "b", "analysis")).toBe("analysis");
    expect(currentStage(getStages(db, "b"))!.stage_key).toBe("analysis");
  });

  it("moveToStage to done finishes the task", () => {
    createTask(db, { id: "d", title: "Finish" });
    startTask(db, "d");
    expect(moveToStage(db, "d", "done")).toBeNull();
    expect(currentStage(getStages(db, "d"))).toBeUndefined();
    expect(boardColumns(db).find((c) => c.stageKey === "done")!.cards.map((c) => c.id)).toEqual(["d"]);
  });

  it("moveToStage leaves skipped (out-of-route) stages untouched", () => {
    createTask(db, { id: "r", title: "Bug", route: ["analysis", "impl", "review", "pr", "done"] });
    startTask(db, "r");
    moveToStage(db, "r", "review");
    const stages = getStages(db, "r");
    expect(stages.find((s) => s.stage_key === "brainstorm")!.status).toBe("skipped");
    expect(stages.find((s) => s.stage_key === "impl")!.status).toBe("done");
    expect(stages.find((s) => s.stage_key === "review")!.status).toBe("active");
  });

  describe("ensureStageInRoute (loom-287h — swarm post-promote QA safety net)", () => {
    it("un-skips a skipped stage to pending and adds it to the route in canonical order", () => {
      // Chore route skips qa — a swarm winner would never hit the full suite.
      createTask(db, { id: "c", title: "Chore", route: ["analysis", "impl", "review", "done"] });
      expect(getStages(db, "c").find((s) => s.stage_key === "qa")!.status).toBe("skipped");

      expect(ensureStageInRoute(db, "c", "qa")).toBe(true);
      expect(getStages(db, "c").find((s) => s.stage_key === "qa")!.status).toBe("pending");
      // route JSON now includes qa, ordered between review and done (canonical)
      expect(JSON.parse(getTask(db, "c")!.route!)).toEqual(["analysis", "impl", "review", "qa", "done"]);
    });

    it("makes the engine actually run the re-added stage after impl/review", () => {
      createTask(db, { id: "c2", title: "Chore", route: ["analysis", "impl", "review", "done"] });
      ensureStageInRoute(db, "c2", "qa");
      startTask(db, "c2");
      completeStage(db, "c2", "analysis"); // → impl (brainstorm/spec/rd skipped)
      completeStage(db, "c2", "impl");     // → review
      expect(completeStage(db, "c2", "review")).toBe("qa"); // qa now runs, not skipped
    });

    it("is a no-op for a stage already in play (returns false)", () => {
      createTask(db, { id: "f", title: "Feature" }); // full route → qa already pending
      expect(ensureStageInRoute(db, "f", "qa")).toBe(false);
      expect(ensureStageInRoute(db, "f", "nonsense")).toBe(false); // unknown stage
    });
  });
});
