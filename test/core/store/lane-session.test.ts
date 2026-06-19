import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getLaneSession, setLaneSession, getLaneSessionIds } from "../../../src/core/store/db.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-lane-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "Lanes" });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("model-lane sessions", () => {
  it("a lane is 'not started' until a session id is recorded for it", () => {
    expect(getLaneSession(db, "t1", "opus")).toEqual({ sessionId: null, started: false });
    setLaneSession(db, "t1", "opus", "sess-opus");
    expect(getLaneSession(db, "t1", "opus")).toEqual({ sessionId: "sess-opus", started: true });
  });

  it("keeps a separate session per model lane", () => {
    setLaneSession(db, "t1", "opus", "sess-opus");
    setLaneSession(db, "t1", "sonnet", "sess-sonnet");
    expect(getLaneSession(db, "t1", "opus").sessionId).toBe("sess-opus");
    expect(getLaneSession(db, "t1", "sonnet").sessionId).toBe("sess-sonnet");
    expect(getLaneSession(db, "t1", "haiku")).toEqual({ sessionId: null, started: false });
  });

  it("lists every lane session id (for cost/stop fan-out)", () => {
    expect(getLaneSessionIds(db, "t1")).toEqual([]);
    setLaneSession(db, "t1", "opus", "sess-opus");
    setLaneSession(db, "t1", "sonnet", "sess-sonnet");
    expect(getLaneSessionIds(db, "t1").sort()).toEqual(["sess-opus", "sess-sonnet"]);
  });

  it("updating a lane replaces its id, not adds a duplicate", () => {
    setLaneSession(db, "t1", "opus", "sess-1");
    setLaneSession(db, "t1", "opus", "sess-2");
    expect(getLaneSession(db, "t1", "opus").sessionId).toBe("sess-2");
    expect(getLaneSessionIds(db, "t1")).toEqual(["sess-2"]);
  });
});
