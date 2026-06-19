import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import { createTaskSession } from "../../../src/core/automation/task-session.js";
import { createAimuxLiveLauncher } from "../../../src/core/automation/aimux-session-launcher.js";
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

// A fake aimux openSession that auto-completes each turn and records how the
// session was opened (resume flag + id) — so we can assert restart recovery.
function fakeOpen() {
  const opens: Array<{ resume: boolean; sessionId: string }> = [];
  const openSession = ((_cfg: unknown, _profile: string, opts: { resume?: boolean; sessionId: string }) => {
    opens.push({ resume: !!opts.resume, sessionId: opts.sessionId });
    return {
      send: async () => ({ text: "ok", costUsd: 0, denials: [] }),
      interject: () => false,
      relocate: () => {},
      cost: () => 0,
      denials: () => [],
      close: () => {},
    };
  }) as never;
  return { openSession, opens };
}

const deps = (openSession: never) => ({
  loadConfig: (() => ({})) as never, // truthy cfg → passes the no-config guard
  profile: "p1",
  openSession,
  listMcp: () => [],
});

describe("session durability — recovery after a host restart", () => {
  it("a started session resumes (not recreates) from a fresh launcher registry", async () => {
    // First run: fresh task → create the session.
    const a = fakeOpen();
    await createTaskSession(db, "t1", { launcher: createAimuxLiveLauncher(deps(a.openSession)) }).send("step 1", { stage: "analysis" });
    expect(a.opens).toHaveLength(1);
    expect(a.opens[0].resume).toBe(false); // created with --session-id
    const sessionId = a.opens[0].sessionId;

    // Simulate a host restart: the live process is gone, a NEW launcher with an
    // empty registry is created. The session_id is still in the DB (durable).
    const b = fakeOpen();
    await createTaskSession(db, "t1", { launcher: createAimuxLiveLauncher(deps(b.openSession)) }).send("step 2", { stage: "spec" });
    expect(b.opens).toHaveLength(1);
    expect(b.opens[0].resume).toBe(true); // recovered with --resume
    expect(b.opens[0].sessionId).toBe(sessionId); // same session, not a new one
  });
});
