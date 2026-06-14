import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import {
  insertRun,
  completeRun,
  getRun,
  listRunsForTask,
  upsertCost,
  getCosts,
} from "../../../src/core/store/execute.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-exec-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "T" });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("core-store/execute", () => {
  it("insertRun + completeRun + getRun round-trips", () => {
    insertRun(db, { id: "r1", taskId: "t1", profile: "work", workflowId: "wf-1" });
    const before = getRun(db, "r1")!;
    expect(before.status).toBe("running");
    expect(before.started_at).toBeGreaterThan(0);
    expect(before.finished_at).toBeNull();

    completeRun(db, "r1", 0, "ok\n", "");
    const after = getRun(db, "r1")!;
    expect(after.status).toBe("done");
    expect(after.exit_code).toBe(0);
    expect(after.stdout).toBe("ok\n");
    expect(after.finished_at).toBeGreaterThan(0);
  });

  it("completeRun marks status failed when exit != 0", () => {
    insertRun(db, { id: "r2", taskId: "t1" });
    completeRun(db, "r2", 1, "", "err");
    expect(getRun(db, "r2")!.status).toBe("failed");
  });

  it("listRunsForTask returns in started_at order", () => {
    insertRun(db, { id: "r3", taskId: "t1" });
    insertRun(db, { id: "r4", taskId: "t1" });
    expect(listRunsForTask(db, "t1").map((r) => r.id)).toEqual(["r3", "r4"]);
  });

  it("getRun returns undefined for missing id", () => {
    expect(getRun(db, "nope")).toBeUndefined();
  });
});

describe("core-store/cost", () => {
  it("upsertCost inserts then updates on conflict", () => {
    upsertCost(db, "t1", "token-pilot", "saved", 100, false);
    expect(getCosts(db, "t1")).toHaveLength(1);
    expect(getCosts(db, "t1")[0]).toMatchObject({ value: 100, exact: 0 });

    upsertCost(db, "t1", "token-pilot", "saved", 200, true);
    expect(getCosts(db, "t1")).toHaveLength(1);
    expect(getCosts(db, "t1")[0]).toMatchObject({ value: 200, exact: 1 });
  });

  it("stores multiple source/metric combos per task", () => {
    upsertCost(db, "t1", "token-pilot", "saved", 100, false);
    upsertCost(db, "t1", "aimux", "spent", 250, true);
    const costs = getCosts(db, "t1");
    expect(costs).toHaveLength(2);
    expect(costs.map((c) => `${c.source}:${c.metric}`).sort()).toEqual([
      "aimux:spent",
      "token-pilot:saved",
    ]);
  });
});
