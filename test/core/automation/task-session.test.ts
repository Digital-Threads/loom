import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTaskSession } from "../../../src/core/store/db.js";
import { setSetting } from "../../../src/core/store/settings.js";
import { createTaskSession, SESSION_PREAMBLE, aboutSection, ABOUT_MAX_CHARS, parseCompleteness, declaresRemainingWork, detectRateLimit, languageDirective, type SessionLauncher } from "../../../src/core/automation/task-session.js";
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
  const calls: Array<{ prompt: string; sessionId: string; resume: boolean; effort?: string }> = [];
  const launcher: SessionLauncher = {
    run: async (prompt, opts) => {
      calls.push({ prompt, sessionId: opts.sessionId, resume: opts.resume, effort: opts.effort });
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

  it("the preamble mandates token-pilot, task-journal, fact-only, and plain-English formatting", () => {
    expect(SESSION_PREAMBLE).toContain("token-pilot");
    expect(SESSION_PREAMBLE).toContain("task-journal");
    expect(SESSION_PREAMBLE).toMatch(/Facts only/i);
    expect(SESSION_PREAMBLE).toMatch(/plain human language/i); // plain language, no jargon (response language is per-step)
    expect(SESSION_PREAMBLE).toMatch(/jargon/i); // no machine/jargon-heavy text
  });

  it("every stage send reinforces the rules + carries the stage", async () => {
    const { launcher, calls } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher });
    await s.send("first", { stage: "analysis" });
    await s.send("impl it", { stage: "impl" });
    expect(calls[1].prompt).toContain("Stage: impl");
    expect(calls[1].prompt).toMatch(/token-pilot.*task-journal|task-journal/);
  });

  it("raw send skips the stage wrapper (user chats with the agent verbatim)", async () => {
    const { launcher, calls } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher });
    await s.send("kick off", { stage: "analysis" }); // create the session first
    await s.send("посмотри в файл X, ты ошибся в анализе", { raw: true });
    // resumed → no preamble; raw → the message goes through verbatim, no "Stage:" head
    expect(calls[1].resume).toBe(true);
    expect(calls[1].prompt).toBe("посмотри в файл X, ты ошибся в анализе");
    expect(calls[1].prompt).not.toContain("Stage");
  });

  it("passes streamed chunks through to onChunk", async () => {
    const { launcher } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher });
    const seen: string[] = [];
    await s.send("go", { stage: "analysis", onChunk: (c) => seen.push(c) });
    expect(seen).toEqual(["chunk"]);
  });

  it("parseCompleteness: parks only on an explicit NOT DONE, passes otherwise", () => {
    expect(parseCompleteness("summary...\nRESULT: DONE").complete).toBe(true);
    expect(parseCompleteness("no marker at all").complete).toBe(true); // missing marker → not blocked
    const r = parseCompleteness("...\nRESULT: NOT DONE — no access to the API");
    expect(r.complete).toBe(false);
    expect(r.note).toContain("no access");
    // Russian sentinel still parses as a fallback for in-flight sessions.
    expect(parseCompleteness("итог...\nИТОГ: ГОТОВО").complete).toBe(true);
    expect(parseCompleteness("...\nИТОГ: НЕ ГОТОВО — нет доступа").complete).toBe(false);
  });

  it("detectRateLimit: flags a provider session-limit message + reset hint", () => {
    const r = detectRateLimit("…working…\nYou've hit your session limit · resets 6:30pm (Asia/Yerevan)");
    expect(r.hit).toBe(true);
    expect(r.resetsAt).toContain("6:30pm");
    expect(detectRateLimit("all good, tests pass").hit).toBe(false);
  });

  it("declaresRemainingWork: catches a ГОТОВО that still lists leftover plan items", () => {
    expect(declaresRemainingWork("Что из плана осталось (следующие эпики): RD-2, RD-3")).toBe(true);
    expect(declaresRemainingWork("осталось реализовать RD-4 и RD-5")).toBe(true);
    expect(declaresRemainingWork("remaining steps: wire the UI")).toBe(true);
    expect(declaresRemainingWork("Всё сделано и проверено, регрессий нет.")).toBe(false);
  });

  it("languageDirective sets the reply language and defaults to English (i18n loom-y14v)", () => {
    expect(languageDirective("ru")).toContain("Russian");
    expect(languageDirective("RU")).toContain("Russian"); // case-insensitive
    expect(languageDirective("en")).toContain("English");
    expect(languageDirective(undefined)).toContain("English"); // default
    expect(languageDirective("xx")).toContain("English"); // unknown → English
    expect(languageDirective("ru")).toMatch(/instructions remain in English/i); // prompts stay English
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

  it("passes the per-turn reasoning effort through to the launcher (loom-daeq)", async () => {
    const { launcher, calls } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher });
    await s.send("hard one", { stage: "spec", effort: "xhigh" });
    await s.send("normal one", { stage: "spec" }); // no effort → undefined
    expect(calls[0].effort).toBe("xhigh");
    expect(calls[1].effort).toBeUndefined();
  });
});

describe("aboutSection — project taste-profile (loom-ioz8)", () => {
  it("returns empty for a blank profile (whitespace counts as blank)", () => {
    expect(aboutSection("")).toBe("");
    expect(aboutSection("   \n\t ")).toBe("");
  });

  it("wraps a real profile in a labeled standing-context section", () => {
    const out = aboutSection("Prefer small pure functions. Avoid global state.");
    expect(out).toMatch(/About this project/i);
    expect(out).toContain("Prefer small pure functions. Avoid global state.");
  });

  it("caps an over-budget profile and marks the truncation", () => {
    const huge = "x".repeat(ABOUT_MAX_CHARS + 500);
    const out = aboutSection(huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toMatch(/trimmed/i);
  });
});

describe("taste-profile injection into the session (loom-ioz8)", () => {
  it("injects the profile once on session creation, after the preamble, never on resume", async () => {
    setSetting(db, "taste.profile", "House style: tabs, no default exports.");
    const { launcher, calls } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher, newId: () => "uuid" });

    // analysis + brainstorm share one model lane (opus), so the 2nd send resumes
    // it — exercising the "no re-inject on resume" path. (A different-model stage
    // would open its own lane and legitimately get the standing context afresh.)
    await s.send("analyze", { stage: "analysis" });  // creation
    await s.send("ideas", { stage: "brainstorm" });  // resume same lane

    expect(calls[0].resume).toBe(false);
    expect(calls[0].prompt).toContain(SESSION_PREAMBLE);
    expect(calls[0].prompt).toContain("House style: tabs, no default exports.");
    // ordering: preamble before the about section
    expect(calls[0].prompt.indexOf(SESSION_PREAMBLE)).toBeLessThan(calls[0].prompt.indexOf("House style"));

    expect(calls[1].resume).toBe(true);
    expect(calls[1].prompt).not.toContain("House style: tabs, no default exports.");
  });

  it("adds nothing when no profile is set", async () => {
    const { launcher, calls } = recordingLauncher();
    const s = createTaskSession(db, "t1", { launcher, newId: () => "uuid" });
    await s.send("analyze", { stage: "analysis" });
    expect(calls[0].prompt).not.toMatch(/About this project/i);
  });
});
