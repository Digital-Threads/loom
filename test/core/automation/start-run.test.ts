import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, setTaskSession } from "../../../src/core/store/db.js";
import { getCosts } from "../../../src/core/store/execute.js";
import { startTask } from "../../../src/core/pipeline/engine.js";
import { advanceTask, type RunnerRegistry } from "../../../src/core/pipeline/conductor.js";
import { startSpecRun } from "../../../src/core/automation/start-run.js";
import { createRunManager } from "../../../src/core/automation/run-manager.js";
import type { StepExecutor } from "../../../src/core/automation/exec-loop.js";
import type { Decomposer } from "../../../src/core/automation/planner.js";
import type { TokenEvent } from "../../../src/core/plugins/token-pilot/adapter.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-startrun-"));
  db = openStore(join(dir, "s.db"));
  createTask(db, { id: "t1", title: "Refund" });
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const decomposer: Decomposer = {
  async decompose() {
    return [
      { id: "s1", title: "tests" },
      { id: "s2", title: "impl", dependsOn: ["s1"] },
    ];
  },
};
const okExecutor: StepExecutor = { async run() { return { exitCode: 0, stdout: "ok" }; } };

describe("startSpecRun (L4.2 wire)", () => {
  it("returns a runId and runs spec→plan→route→exec, emitting lifecycle events", async () => {
    const rm = createRunManager();
    const runId = startSpecRun(rm, db, "t1", "build refund", { projectId: "p1", workflowId: "wf1" }, {
      deps: { decomposer, executor: okExecutor },
      candidates: [{ profile: "work" }],
    });
    expect(runId).toMatch(/^run_[0-9a-f]{16}$/);
    const rec = await rm.wait(runId);
    expect(rec.status).toBe("done");
    const result = rec.result as { steps: number; assigned: number; exec: { dag: { ok: boolean } } };
    expect(result.steps).toBe(2);
    expect(result.assigned).toBe(2); // both routed to the live candidate
    expect(result.exec.dag.ok).toBe(true);
    expect(rec.events.map((e) => e.type)).toEqual([
      "run.started", "step.started", "step.completed", "step.started", "step.completed", "run.completed",
    ]);
  });

  it("reports unrouted steps when no candidate is eligible", async () => {
    const rm = createRunManager();
    const runId = startSpecRun(rm, db, "t1", "x", { projectId: "p1" }, {
      deps: { decomposer, executor: okExecutor },
      candidates: [], // nothing to route to
    });
    const rec = await rm.wait(runId);
    const result = rec.result as { assigned: number; unrouted: string[] };
    expect(result.assigned).toBe(0);
    expect(result.unrouted).toEqual(["s1", "s2"]);
  });
});

// Reader the cost-cap uses (api.ts spentUsd / conductor.ts): the task's real
// aimux spend in USD. Before the fix L4 left this at 0, so the cap never tripped.
const aimuxSpent = (database: Database.Database, taskId: string): number =>
  getCosts(database, taskId)
    .filter((r) => r.source === "aimux" && r.metric === "spent")
    .reduce((sum, r) => sum + r.value, 0);

describe("startSpecRun cost recording (money-safety: L4 cost-cap)", () => {
  const tokenEvents: TokenEvent[] = [
    { sessionId: "sess-1", used: 100, saved: 20, ts: 1, agentType: null, taskId: "t1" },
  ];

  it("records real $ spend + sessionId for L4 so the cost-cap can read aimux/spent", async () => {
    setTaskSession(db, "t1", "sess-1"); // task has a live session → costOf(sid) is meaningful
    const rm = createRunManager();
    const runId = startSpecRun(rm, db, "t1", "build refund", { projectId: "p1", taskId: "t1" }, {
      deps: { decomposer, executor: okExecutor },
      candidates: [{ profile: "work" }],
      loadTokenEvents: () => tokenEvents,
      costOf: (sid) => (sid === "sess-1" ? 42 : 0),
    });
    await rm.wait(runId);

    // The exact reader the cost-cap consumes is now non-zero for L4.
    expect(aimuxSpent(db, "t1")).toBe(42);
    // cost-cap logic (conductor.ts:86): spent >= cap → trip. Was impossible at $0.
    const cap = 10;
    expect(aimuxSpent(db, "t1") >= cap).toBe(true);
    // Token accounting is untouched (still recorded alongside the spend).
    const used = getCosts(db, "t1").find((c) => c.source === "token-pilot" && c.metric === "used");
    expect(used?.value).toBe(100);
  });

  it("records no spend (and the cap stays at $0) when the task has no session", async () => {
    // No setTaskSession → sid is null → spent omitted, exactly as before the fix.
    const rm = createRunManager();
    const runId = startSpecRun(rm, db, "t1", "build refund", { projectId: "p1", taskId: "t1" }, {
      deps: { decomposer, executor: okExecutor },
      candidates: [{ profile: "work" }],
      loadTokenEvents: () => tokenEvents,
      costOf: () => 99, // never consulted: no sid
    });
    await rm.wait(runId);

    expect(aimuxSpent(db, "t1")).toBe(0);
    // Token accounting still works without a session — no regression.
    const used = getCosts(db, "t1").find((c) => c.source === "token-pilot" && c.metric === "used");
    expect(used?.value).toBe(100);
  });

  it("the spend it writes trips the REAL conductor cost-cap (end-to-end)", async () => {
    createTask(db, { id: "tc", title: "Cap", route: ["analysis", "impl", "done"], run_mode: "autopilot" });
    startTask(db, "tc");
    setTaskSession(db, "tc", "sess-c");
    const rm = createRunManager();
    const runId = startSpecRun(rm, db, "tc", "build refund", { projectId: "p1", taskId: "tc" }, {
      deps: { decomposer, executor: okExecutor },
      candidates: [{ profile: "work" }],
      loadTokenEvents: () => [],
      costOf: () => 10,
    });
    await rm.wait(runId);

    // Drive the production guard: advanceTask reads the rollup the L4 run wrote.
    const calls: string[] = [];
    const runners: RunnerRegistry = {
      analysis: async () => { calls.push("analysis"); return { ok: true }; },
    };
    const r = await advanceTask(db, "tc", runners, { costCapUsd: 5, spentUsd: (id) => aimuxSpent(db, id) });
    expect(calls).toEqual([]); // cap tripped before any stage ran
    expect(r.reason?.kind).toBe("cost_cap");
    expect(r.reason?.spent).toBe(10);
  });

  it("does not fail a finished run when costOf throws (cost is best-effort)", async () => {
    setTaskSession(db, "t1", "sess-1");
    const rm = createRunManager();
    const runId = startSpecRun(rm, db, "t1", "build refund", { projectId: "p1", taskId: "t1" }, {
      deps: { decomposer, executor: okExecutor },
      candidates: [{ profile: "work" }],
      loadTokenEvents: () => [],
      costOf: () => { throw new Error("cost source down"); },
    });
    const rec = await rm.wait(runId);
    expect(rec.status).toBe("done"); // accounting error must not sink the run
    expect(aimuxSpent(db, "t1")).toBe(0);
  });
});
