import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSpineIds,
  spineEnv,
  readSpineIds,
} from "../../../src/core/spine/ids.js";
import { loadLoomEvents } from "../../../src/core/spine/event-bus.js";
import { openStore, createTask } from "../../../src/core/store/db.js";
import { createStep } from "../../../src/core/store/steps.js";
import { runDag, busSink, type StepExecutor } from "../../../src/core/automation/exec-loop.js";
import { taskCost } from "../../../src/core/metrics/tokens-per-task.js";
import type { TokenEvent } from "../../../src/core/plugins/token-pilot/adapter.js";
import type Database from "better-sqlite3";

// F0.5 — spine contract gate. Ties F0.1–F0.4 together end-to-end with a stub
// executor: build the four ids, carry them via the LOOM_* env, let the "session"
// read them back and (as token-pilot's hook would) stamp task_id onto its token
// events, then prove the run is observable in the bus AND per-task cost is exact.

describe("F0.5 spine contract (build → env → session → exact cost)", () => {
  let prevXdg: string | undefined;
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    prevXdg = process.env.XDG_DATA_HOME;
    dir = mkdtempSync(join(tmpdir(), "loom-contract-"));
    process.env.XDG_DATA_HOME = dir; // event bus → <dir>/loom/events
    db = openStore(join(dir, "state.db"));
    createTask(db, { id: "tj-int", title: "wire the spine" });
    createStep(db, { id: "s1", taskId: "tj-int", title: "do it" });
  });

  afterEach(() => {
    db.close();
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  it("delivers exact cost and a recorded run via the spine env contract", async () => {
    const repoRoot = join(dir, "repo");
    mkdirSync(join(repoRoot, ".git"), { recursive: true });

    const ids = buildSpineIds({ repoRoot, profileId: "work", taskId: "tj-int" });
    expect(ids.workflowId).toMatch(/^wf_[0-9a-f]{16}$/);

    // The env contract carried into a launched session round-trips intact.
    const env = spineEnv(ids);
    expect(readSpineIds(env)).toEqual(ids);

    // Stub session: reads the spine from its env (as a real agent would) and,
    // like token-pilot's hook, emits a token event stamped with that task_id.
    const tokenEvents: TokenEvent[] = [];
    const stub: StepExecutor = {
      async run(req) {
        const seen = readSpineIds(spineEnv(req.ids));
        tokenEvents.push({
          sessionId: req.ids.workflowId ?? "s",
          used: 1200,
          saved: 300,
          ts: 1,
          agentType: "claude",
          taskId: seen.taskId, // stamped from LOOM_TASK_ID
        });
        return { exitCode: 0, stdout: "done" };
      },
    };

    const result = await runDag(db, stub, "tj-int", ids, undefined, busSink(ids.projectId));
    expect(result.ok).toBe(true);

    // F0.3: the run is observable in the event bus.
    const types = loadLoomEvents(ids.projectId).map((e) => e.type);
    expect(types).toEqual(["run.started", "step.started", "step.completed", "run.completed"]);

    // F0.4: per-task cost is EXACT (summed from task_id-tagged events), spent > 0.
    const cost = taskCost([], "tj-int", tokenEvents);
    expect(cost.exact).toBe(true);
    expect(cost.used).toBe(1200);
    expect(cost.saved).toBe(300);
  });

  it("falls back to estimate provenance when no event carries the task_id", () => {
    const untagged: TokenEvent[] = [
      { sessionId: "x", used: 50, saved: 5, ts: 1, agentType: null, taskId: null },
    ];
    expect(taskCost([], "tj-int", untagged).exact).toBe(false);
  });
});
