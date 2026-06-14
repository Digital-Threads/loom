import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import { createTaskSession } from "../../../src/core/automation/task-session.js";
import { createLiveSessionLauncher, type SpawnSession, type ProcLike } from "../../../src/core/automation/live-session.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-restart-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "Durable" });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// A fake spawn that auto-completes each turn and records how it was started.
function fakeSpawn() {
  const spawns: Array<{ resume: boolean; sessionId: string }> = [];
  const spawn: SpawnSession = ({ sessionId, resume }) => {
    let onData: ((d: string) => void) | undefined;
    spawns.push({ resume, sessionId });
    const proc: ProcLike = {
      stdin: { write: () => queueMicrotask(() => onData?.(JSON.stringify({ type: "result", subtype: "success", result: "ok" }) + "\n")), end: () => {} },
      stdout: { on: (_e, cb) => { onData = cb as (d: string) => void; } },
      on: () => {},
      kill: () => {},
    };
    return proc;
  };
  return { spawn, spawns };
}

describe("session durability — recovery after a host restart", () => {
  it("a started session resumes (not recreates) from a fresh launcher registry", async () => {
    // First run: fresh task → create the session.
    const a = fakeSpawn();
    await createTaskSession(db, "t1", { launcher: createLiveSessionLauncher({ spawn: a.spawn }) }).send("step 1", { stage: "analysis" });
    expect(a.spawns).toHaveLength(1);
    expect(a.spawns[0].resume).toBe(false); // created with --session-id
    const sessionId = a.spawns[0].sessionId;

    // Simulate a host restart: the live process is gone, a NEW launcher with an
    // empty registry is created. The session_id is still in the DB (durable).
    const b = fakeSpawn();
    await createTaskSession(db, "t1", { launcher: createLiveSessionLauncher({ spawn: b.spawn }) }).send("step 2", { stage: "spec" });
    expect(b.spawns).toHaveLength(1);
    expect(b.spawns[0].resume).toBe(true); // recovered with --resume
    expect(b.spawns[0].sessionId).toBe(sessionId); // same session, not a new one
  });
});
