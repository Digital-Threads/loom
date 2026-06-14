import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getStages } from "../../../src/core/store/db.js";
import { createApi } from "../../../src/web/api.js";
import { createRunManager } from "../../../src/core/automation/run-manager.js";
import { startSpecRun } from "../../../src/core/automation/start-run.js";
import type { Decomposer } from "../../../src/core/automation/planner.js";
import type { StepExecutor } from "../../../src/core/automation/exec-loop.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-l4it-"));
  db = openStore(join(dir, "s.db"));
  createTask(db, { id: "t1", title: "Refund flow", description: "add a refund endpoint with tests" });
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

// L4.7 — end-to-end through the API: POST run → spec decomposed → DAG executed →
// runId observable → run settles done, with the impl stage advanced and the run
// snapshot reporting the lifecycle events. Decomposer/executor are stubbed (no
// model/CLI), exercising the real wiring (start-run → run-manager → orchestrate
// → exec-loop → events → API).
describe("L4.7 automation integration (API → runId → done)", () => {
  it("runs a spec through the pipeline and reports done via the run API", async () => {
    const rm = createRunManager();
    const decomposer: Decomposer = {
      async decompose() {
        return [
          { id: "s1", title: "write tests" },
          { id: "s2", title: "implement", dependsOn: ["s1"] },
        ];
      },
    };
    const executor: StepExecutor = { async run() { return { exitCode: 0, stdout: "ok" }; } };

    const app = createApi(db, {
      runManager: rm,
      startRun: (taskId) =>
        startSpecRun(rm, db, taskId, "add a refund endpoint", { projectId: "p1", workflowId: "wf1" }, {
          deps: { decomposer, executor },
          candidates: [{ profile: "work" }],
        }),
    });

    // 1. start the run via the API
    const { runId } = (await (await app.request("/api/tasks/t1/stages/rd/run", { method: "POST" })).json()) as { runId: string };
    expect(runId).toMatch(/^run_[0-9a-f]{16}$/);

    // 2. let it settle, then read the snapshot
    await rm.wait(runId);
    const snap = (await (await app.request(`/api/runs/${runId}`)).json()) as {
      status: string;
      events: { type: string }[];
    };
    expect(snap.status).toBe("done");
    expect(snap.events.map((e) => e.type)).toEqual([
      "run.started", "step.started", "step.completed", "step.started", "step.completed", "run.completed",
    ]);

    // 3. the impl stage advanced (DAG ok → completeStage)
    const impl = getStages(db, "t1").find((s) => s.stage_key === "impl");
    expect(impl?.status).toBe("done");
  });
});
