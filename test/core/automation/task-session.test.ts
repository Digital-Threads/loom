import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTaskSession } from "../../../src/core/store/db.js";
import { createTaskSession, SESSION_PREAMBLE, parseCompleteness, type SessionLauncher } from "../../../src/core/automation/task-session.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-sess-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "Task" });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function recordingLauncher() {
  const calls: Array<{ prompt: string; sessionId: string; resume: boolean }> = [];
  const launcher: SessionLauncher = {
    run: async (prompt, opts) => {
      calls.push({ prompt, sessionId: opts.sessionId, resume: opts.resume });
      opts.onChunk?.("chunk");
      return { text: "ok" };
    },
  };
  return { launcher, calls };
}

describe("TaskSession (one session per task)", () => {
  it("first send creates the session with the preamble; later sends resume the same id", async () => {
    const { launcher, calls } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher, newId: () => "fixed-uuid" });

    await s.send("analyze the task", { stage: "analysis" });
    await s.send("ask questions", { stage: "brainstorm" });

    // first call: create (resume=false), preamble present
    expect(calls[0].resume).toBe(false);
    expect(calls[0].sessionId).toBe("fixed-uuid");
    expect(calls[0].prompt).toContain(SESSION_PREAMBLE);
    expect(calls[0].prompt).toContain("analyze the task");

    // second call: resume same id, NO full preamble (just reinforcement)
    expect(calls[1].resume).toBe(true);
    expect(calls[1].sessionId).toBe("fixed-uuid");
    expect(calls[1].prompt).not.toContain(SESSION_PREAMBLE);
    expect(calls[1].prompt).toContain("ask questions");

    // session id persisted on the task
    expect(getTaskSession(db, "t1")).toEqual({ sessionId: "fixed-uuid", started: true });
  });

  it("the preamble mandates token-pilot, task-journal, fact-only, and plain user-language formatting", () => {
    expect(SESSION_PREAMBLE).toContain("token-pilot");
    expect(SESSION_PREAMBLE).toContain("task-journal");
    expect(SESSION_PREAMBLE).toMatch(/Только факт/i);
    expect(SESSION_PREAMBLE).toMatch(/язык(е)? пользовател/i); // user's language, not hard-coded Russian
    expect(SESSION_PREAMBLE).toMatch(/жаргон/i); // no machine/jargon-heavy text
  });

  it("every stage send reinforces the rules + carries the stage", async () => {
    const { launcher, calls } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher });
    await s.send("first", { stage: "analysis" });
    await s.send("impl it", { stage: "impl" });
    expect(calls[1].prompt).toContain("Стадия: impl");
    expect(calls[1].prompt).toMatch(/token-pilot.*task-journal|task-journal/);
  });

  it("raw send skips the stage wrapper (user chats with the agent verbatim)", async () => {
    const { launcher, calls } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher });
    await s.send("kick off", { stage: "analysis" }); // create the session first
    await s.send("посмотри в файл X, ты ошибся в анализе", { raw: true });
    // resumed → no preamble; raw → the message goes through verbatim, no "Стадия:" head
    expect(calls[1].resume).toBe(true);
    expect(calls[1].prompt).toBe("посмотри в файл X, ты ошибся в анализе");
    expect(calls[1].prompt).not.toContain("Стадия");
  });

  it("passes streamed chunks through to onChunk", async () => {
    const { launcher } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher });
    const seen: string[] = [];
    await s.send("go", { stage: "analysis", onChunk: (c) => seen.push(c) });
    expect(seen).toEqual(["chunk"]);
  });

  it("parseCompleteness: parks only on an explicit НЕ ГОТОВО, passes otherwise", () => {
    expect(parseCompleteness("итог...\nИТОГ: ГОТОВО").complete).toBe(true);
    expect(parseCompleteness("no marker at all").complete).toBe(true); // missing marker → not blocked
    const r = parseCompleteness("...\nИТОГ: НЕ ГОТОВО — нет доступа к API");
    expect(r.complete).toBe(false);
    expect(r.note).toContain("нет доступа");
  });

  it("compacts the session once the turn threshold is reached", async () => {
    const { launcher } = recordingLauncher();
    const compacted: string[] = [];
    const s = createTaskSession(db, "t1", {
      launcher,
      newId: () => "sid",
      compactEvery: 2,
      compact: async ({ sessionId }) => { compacted.push(sessionId); },
    });
    await s.send("1", { stage: "a" }); // turns 0→1
    await s.send("2", { stage: "b" }); // turns 1→2
    await s.send("3", { stage: "c" }); // turns==2 before send → compact fires
    expect(compacted).toEqual(["sid"]);
  });
});
