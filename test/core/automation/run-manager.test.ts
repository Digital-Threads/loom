import { describe, it, expect } from "vitest";
import { createRunManager, retryingExecutor } from "../../../src/core/automation/run-manager.js";
import { makeEvent } from "../../../src/core/spine/event.js";
import type { StepExecutor, ExecResult } from "../../../src/core/automation/exec-loop.js";

describe("run-manager (L4.3)", () => {
  it("returns a runId immediately and settles to done with result + events", async () => {
    const rm = createRunManager();
    const runId = rm.start({ projectId: "p1", toBus: false }, async (ctx) => {
      ctx.emit(makeEvent({ ts: 1, source: "loom", projectId: "p1", type: "run.started" }));
      ctx.appendOutput("hello");
      return { ran: 1 };
    });
    expect(runId).toMatch(/^run_[0-9a-f]{16}$/);
    expect(rm.get(runId)!.status).toBe("running");
    const rec = await rm.wait(runId);
    expect(rec.status).toBe("done");
    expect(rec.result).toEqual({ ran: 1 });
    expect(rec.events.map((e) => e.type)).toEqual(["run.started"]);
    expect(rec.output).toEqual(["hello"]);
  });

  it("captures failure as status failed + error", async () => {
    const rm = createRunManager();
    const runId = rm.start({ projectId: "p1", toBus: false }, async () => {
      throw new Error("boom");
    });
    const rec = await rm.wait(runId);
    expect(rec.status).toBe("failed");
    expect(rec.error).toBe("boom");
  });

  it("tracks child runs by parentRunId (swarm fan-out)", async () => {
    const rm = createRunManager();
    const parent = rm.start({ projectId: "p1", toBus: false }, async () => 0);
    const child1 = rm.start({ projectId: "p1", parentRunId: parent, toBus: false }, async () => 1);
    const child2 = rm.start({ projectId: "p1", parentRunId: parent, toBus: false }, async () => 2);
    await Promise.all([rm.wait(parent), rm.wait(child1), rm.wait(child2)]);
    expect(rm.childrenOf(parent).map((r) => r.runId).sort()).toEqual([child1, child2].sort());
  });

  it("calls persist.start on start and persist.settle on settle (durable runs)", async () => {
    const events: Array<[string, string]> = [];
    const rm = createRunManager({
      start: (rec) => events.push(["start", rec.status]),
      settle: (rec) => events.push(["settle", rec.status]),
    });
    const runId = rm.start({ projectId: "p1", taskId: "t1", toBus: false }, async (ctx) => { ctx.appendOutput("x"); return 1; });
    const rec = await rm.wait(runId);
    expect(rec.taskId).toBe("t1");
    expect(events).toEqual([["start", "running"], ["settle", "done"]]);
  });

  it("delivers injected stdin to the registered onInput handler (loom-isd.13)", async () => {
    const rm = createRunManager();
    const received: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runId = rm.start({ projectId: "p1", toBus: false }, async (ctx) => {
      ctx.onInput((data) => received.push(data));
      await gate; // keep the run live so input can be injected
      return received.length;
    });
    expect(rm.sendInput(runId, "y\n")).toBe(true);
    expect(rm.sendInput(runId, "approve\n")).toBe(true);
    release();
    const rec = await rm.wait(runId);
    expect(received).toEqual(["y\n", "approve\n"]);
    expect(rec.result).toBe(2);
  });

  it("sendInput returns false for an unknown run or one without a handler", async () => {
    const rm = createRunManager();
    expect(rm.sendInput("run_deadbeefdeadbeef", "x")).toBe(false);
    const runId = rm.start({ projectId: "p1", toBus: false }, async () => 0);
    await rm.wait(runId); // settled → handler cleaned up
    expect(rm.sendInput(runId, "x")).toBe(false);
  });
});

describe("run-manager stop guarantees live-session kill", () => {
  // keep a run live until released, so stop() acts on a "running" record
  function liveRun(rm: ReturnType<typeof createRunManager>) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runId = rm.start({ projectId: "p1", taskId: "t1", toBus: false }, async () => { await gate; return 0; });
    return { runId, release };
  }

  it("stop always invokes stopLive with the run record (kills the live process)", async () => {
    const killed: string[] = [];
    const rm = createRunManager(undefined, { stopLive: (rec) => killed.push(rec.taskId!) });
    const { runId, release } = liveRun(rm);
    expect(rm.stop(runId)).toBe(true);
    expect(killed).toEqual(["t1"]); // stopLive ran exactly once
    expect(rm.get(runId)!.status).toBe("failed");
    release();
    await rm.wait(runId);
  });

  it("does not invoke stopLive for an unknown or already-settled run", async () => {
    let calls = 0;
    const rm = createRunManager(undefined, { stopLive: () => { calls += 1; } });
    expect(rm.stop("run_deadbeefdeadbeef")).toBe(false);
    const runId = rm.start({ projectId: "p1", toBus: false }, async () => 0);
    await rm.wait(runId); // settled
    expect(rm.stop(runId)).toBe(false);
    expect(calls).toBe(0);
  });

  it("survives a throwing stopLive (best-effort) and still stops the run", async () => {
    const rm = createRunManager(undefined, { stopLive: () => { throw new Error("kill failed"); } });
    const { runId, release } = liveRun(rm);
    expect(rm.stop(runId)).toBe(true);
    expect(rm.get(runId)!.status).toBe("failed");
    release();
    await rm.wait(runId);
  });
});

describe("retryingExecutor (L4.8)", () => {
  function flaky(failTimes: number): StepExecutor & { attempts: number } {
    let attempts = 0;
    return {
      get attempts() { return attempts; },
      async run(): Promise<ExecResult> {
        attempts += 1;
        return attempts <= failTimes ? { exitCode: 1, stderr: "fail" } : { exitCode: 0, stdout: "ok" };
      },
    } as StepExecutor & { attempts: number };
  }

  it("retries a failing step up to maxRetries, then succeeds", async () => {
    const ex = flaky(2);
    const wrapped = retryingExecutor(ex, { maxRetries: 3 });
    const res = await wrapped.run({ taskId: "t", step: { id: "s" } as never, ids: { projectId: "p" } });
    expect(res.exitCode).toBe(0);
    expect(ex.attempts).toBe(3); // 2 fails + 1 success
  });

  it("stays failed when retries are exhausted", async () => {
    const ex = flaky(5);
    const res = await retryingExecutor(ex, { maxRetries: 2 }).run({ taskId: "t", step: { id: "s" } as never, ids: { projectId: "p" } });
    expect(res.exitCode).toBe(1);
    expect(ex.attempts).toBe(3); // initial + 2 retries
  });
});
