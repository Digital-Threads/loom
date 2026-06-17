import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTask, setStageGate } from "../../../src/core/store/db.js";
import { startTask } from "../../../src/core/pipeline/engine.js";
import { advanceTask, runAndAdvance, type RunnerRegistry, type StageOutcome } from "../../../src/core/pipeline/conductor.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;
const ROUTE = ["analysis", "impl", "done"];

function seed(runMode: string) {
  createTask(db, { id: "t1", title: "T", route: ROUTE, run_mode: runMode });
  startTask(db, "t1");
}
function okRunners(calls: string[]): RunnerRegistry {
  const mk = (k: string) => async (): Promise<StageOutcome> => { calls.push(k); return { ok: true }; };
  return { analysis: mk("analysis"), impl: mk("impl"), done: mk("done") };
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "loom-cond-")); db = openStore(join(dir, "s.db")); });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe("conductor (L13)", () => {
  it("autopilot runs the whole route to done (gates ignored)", async () => {
    seed("autopilot");
    const calls: string[] = [];
    const r = await advanceTask(db, "t1", okRunners(calls));
    expect(calls).toEqual(["analysis", "impl", "done"]);
    expect(r.stoppedAt).toBeNull();
    expect(getTask(db, "t1")?.status).toBe("done");
  });

  it("gated auto-runs gate=0 stages and parks at the first gate=1", async () => {
    seed("gated");
    setStageGate(db, "t1", "analysis", false); // auto
    setStageGate(db, "t1", "impl", true); // approval
    const calls: string[] = [];
    const r = await advanceTask(db, "t1", okRunners(calls));
    expect(calls).toEqual(["analysis"]);
    expect(r.stoppedAt).toBe("impl");
  });

  it("manual parks immediately; runAndAdvance runs one stage then parks", async () => {
    seed("manual");
    const calls: string[] = [];
    expect((await advanceTask(db, "t1", okRunners(calls))).stoppedAt).toBe("analysis");
    expect(calls).toEqual([]);
    const r = await runAndAdvance(db, "t1", okRunners(calls));
    expect(calls).toEqual(["analysis"]); // ran current; manual won't auto-continue
    expect(r.stoppedAt).toBe("impl");
  });

  it("stops at a failing stage (parks for attention)", async () => {
    seed("autopilot");
    const calls: string[] = [];
    const runners: RunnerRegistry = {
      analysis: async () => { calls.push("analysis"); return { ok: true }; },
      impl: async () => { calls.push("impl"); return { ok: false, note: "boom" }; },
    };
    const r = await advanceTask(db, "t1", runners);
    expect(calls).toEqual(["analysis", "impl"]);
    expect(r.stoppedAt).toBe("impl");
    expect(getTask(db, "t1")?.status).not.toBe("done");
  });

  it("cost cap: stops the pipeline when spend exceeds the cap", async () => {
    createTask(db, { id: "tc", title: "Cap", route: ["analysis", "impl", "done"], run_mode: "autopilot" });
    startTask(db, "tc");
    const calls: string[] = [];
    const runners: RunnerRegistry = {
      analysis: async () => { calls.push("analysis"); return { ok: true }; },
      impl: async () => { calls.push("impl"); return { ok: true }; },
    };
    const r = await advanceTask(db, "tc", runners, {
      costCapUsd: 5,
      spentUsd: () => 7.5, // already over
    });
    expect(calls).toEqual([]); // never even ran analysis
    expect(r.stoppedAt).toBe("analysis");
    expect(r.reason?.kind).toBe("cost_cap");
    expect(r.reason?.cap).toBe(5);
  });

  it("rate limit: stops the pipeline after a stage hits the provider limit", async () => {
    createTask(db, { id: "trl", title: "RL", route: ["analysis", "impl", "done"], run_mode: "autopilot" });
    startTask(db, "trl");
    const calls: string[] = [];
    const runners: RunnerRegistry = {
      analysis: async () => { calls.push("analysis"); return { ok: true }; },
      impl: async () => { calls.push("impl"); return { ok: true }; },
    };
    const r = await advanceTask(db, "trl", runners, {
      // analysis hits the limit; impl must NOT fire into the exhausted profile.
      rateLimited: (_id, stage) => (stage === "analysis" ? { resetsAt: "2026-06-17T12:00:00Z", profile: "work" } : null),
    });
    expect(calls).toEqual(["analysis"]); // impl never ran
    expect(r.stoppedAt).toBe("analysis");
    expect(r.reason?.kind).toBe("rate_limit");
    expect(r.reason?.resetsAt).toBe("2026-06-17T12:00:00Z");
  });
});
