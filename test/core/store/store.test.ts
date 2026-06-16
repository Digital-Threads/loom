import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTaskStatus,
  getStages,
  updateStageStatus,
  setStageGate,
  setTaskSession,
  getTaskSession,
} from "../../../src/core/store/db.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-store-"));
  db = openStore(join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("core-store", () => {
  it("self-heals an older store missing the session columns (no 500)", () => {
    const p = join(dir, "old.db");
    // build a v0-shaped tasks table WITHOUT the session columns + a row.
    const seed = openStore(p);
    seed.exec("DROP TABLE tasks");
    seed.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT, run_mode TEXT, route TEXT, repo TEXT, branch TEXT, description TEXT, created_at INTEGER, updated_at INTEGER)");
    seed.prepare("INSERT INTO tasks (id,title,status,created_at,updated_at) VALUES ('t','Old','created',1,1)").run();
    seed.close();
    // reopen → ensureColumns must add session_id / session_started.
    const db2 = openStore(p);
    expect(() => setTaskSession(db2, "t", "sess-1")).not.toThrow(); // was the 500
    expect(getTaskSession(db2, "t")).toEqual({ sessionId: "sess-1", started: true });
    db2.close();
  });

  it("a new task has no session yet (created on first stage call)", () => {
    createTask(db, { id: "ts0", title: "Sess" });
    expect(getTaskSession(db, "ts0")).toEqual({ sessionId: null, started: false });
  });

  it("setTaskSession stores the id and flips started → resume from then on", () => {
    createTask(db, { id: "ts1", title: "Sess" });
    setTaskSession(db, "ts1", "11111111-2222-3333-4444-555555555555");
    expect(getTaskSession(db, "ts1")).toEqual({ sessionId: "11111111-2222-3333-4444-555555555555", started: true });
    expect(getTask(db, "ts1")!.session_id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("creates a task and seeds stage rows for full route", () => {
    const task = createTask(db, { id: "t1", title: "Refund API" });
    expect(task.id).toBe("t1");
    expect(task.status).toBe("created");
    expect(task.run_mode).toBe("gated");
    expect(JSON.parse(task.route!)).toHaveLength(9);

    const stages = getStages(db, "t1");
    expect(stages).toHaveLength(9);
    expect(stages[0]).toMatchObject({ stage_key: "analysis", status: "pending", gate: 1 });
    expect(stages[8]).toMatchObject({ stage_key: "done", status: "pending" });
  });

  it("marks skipped stages for a partial route (bugfix)", () => {
    createTask(db, { id: "t2", title: "Fix typo", route: ["analysis", "impl", "review", "pr", "done"] });
    const stages = getStages(db, "t2");
    const skipped = stages.filter((s) => s.status === "skipped");
    expect(skipped.map((s) => s.stage_key).sort()).toEqual(["brainstorm", "qa", "rd", "spec"]);
    const pending = stages.filter((s) => s.status === "pending");
    expect(pending.map((s) => s.stage_key)).toEqual(["analysis", "impl", "review", "pr", "done"]);
  });

  it("updateTaskStatus + getTask round-trips", () => {
    createTask(db, { id: "t3", title: "Test" });
    updateTaskStatus(db, "t3", "running");
    expect(getTask(db, "t3")!.status).toBe("running");
  });

  it("listTasks returns newest-first", () => {
    createTask(db, { id: "t4", title: "A" });
    createTask(db, { id: "t5", title: "B" });
    updateTaskStatus(db, "t4", "done"); // touches updated_at
    expect(listTasks(db).map((t) => t.id)).toEqual(["t4", "t5"]);
  });

  it("updateStageStatus sets started_at / finished_at", () => {
    createTask(db, { id: "t6", title: "X" });
    updateStageStatus(db, "t6", "analysis", "active");
    const s1 = getStages(db, "t6").find((s) => s.stage_key === "analysis")!;
    expect(s1.status).toBe("active");
    expect(s1.started_at).toBeGreaterThan(0);
    expect(s1.finished_at).toBeNull();

    updateStageStatus(db, "t6", "analysis", "done");
    const s2 = getStages(db, "t6").find((s) => s.stage_key === "analysis")!;
    expect(s2.status).toBe("done");
    expect(s2.finished_at).toBeGreaterThan(0);
    expect(s2.started_at).toBe(s1.started_at); // didn't overwrite
  });

  it("setStageGate toggles the gate flag", () => {
    createTask(db, { id: "t7", title: "G" });
    setStageGate(db, "t7", "spec", false);
    expect(getStages(db, "t7").find((s) => s.stage_key === "spec")!.gate).toBe(0);
    setStageGate(db, "t7", "spec", true);
    expect(getStages(db, "t7").find((s) => s.stage_key === "spec")!.gate).toBe(1);
  });

  it("run_mode defaults to gated but accepts override", () => {
    createTask(db, { id: "t8", title: "Auto", run_mode: "autopilot" });
    expect(getTask(db, "t8")!.run_mode).toBe("autopilot");
  });

  it("getTask returns undefined for missing id", () => {
    expect(getTask(db, "nope")).toBeUndefined();
  });

  it("deleteTask removes the task and its related rows", () => {
    createTask(db, { id: "d1", title: "Doomed" });
    expect(getStages(db, "d1").length).toBeGreaterThan(0); // seeded children

    expect(deleteTask(db, "d1")).toBe(true);
    expect(getTask(db, "d1")).toBeUndefined();
    expect(getStages(db, "d1")).toHaveLength(0); // children gone too
  });

  it("deleteTask returns false for a missing task", () => {
    expect(deleteTask(db, "ghost")).toBe(false);
  });
});
