import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import { startSpecRun } from "../../../src/core/automation/start-run.js";
import { createRunManager } from "../../../src/core/automation/run-manager.js";
import type { StepExecutor } from "../../../src/core/automation/exec-loop.js";
import type { Decomposer } from "../../../src/core/automation/planner.js";
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
