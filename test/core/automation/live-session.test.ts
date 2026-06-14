import { describe, it, expect } from "vitest";
import { createLiveSessionLauncher, type SpawnSession, type ProcLike } from "../../../src/core/automation/live-session.js";

// A fake process: each stdin.write auto-emits an assistant chunk then a result
// (one turn). Tests can also force-close it to simulate death.
function fakeSpawn() {
  const spawned: Array<{ resume: boolean; sessionId: string; proc: ProcLike & { close(): void } }> = [];
  const spawn: SpawnSession = ({ sessionId, resume }) => {
    let onData: ((d: string) => void) | undefined;
    let onClose: (() => void) | undefined;
    const proc = {
      stdin: {
        write: () => {
          queueMicrotask(() => {
            onData?.(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }) + "\n");
            onData?.(JSON.stringify({ type: "result", subtype: "success", result: "done", total_cost_usd: 0.02 }) + "\n");
          });
        },
        end: () => {},
      },
      stdout: { on: (_e: "data", cb: (d: string | Buffer) => void) => { onData = cb as (d: string) => void; } },
      on: (e: "close" | "error", cb: () => void) => { if (e === "close") onClose = cb; },
      kill: () => {},
      close: () => onClose?.(),
    };
    spawned.push({ resume, sessionId, proc });
    return proc;
  };
  return { spawn, spawned };
}

describe("live session launcher", () => {
  it("keeps ONE process for many turns (no respawn, no resume between steps)", async () => {
    const { spawn, spawned } = fakeSpawn();
    const l = createLiveSessionLauncher({ spawn });
    const a = await l.run("step 1", { sessionId: "s", resume: false });
    const b = await l.run("step 2", { sessionId: "s", resume: true }); // started → but proc alive, no respawn
    expect(a.text).toBe("done");
    expect(b.text).toBe("done");
    expect(spawned).toHaveLength(1); // one process served both turns
    expect(spawned[0].resume).toBe(false); // first spawn created the session
  });

  it("respawns with --resume only after the process dies (recovery)", async () => {
    const { spawn, spawned } = fakeSpawn();
    const l = createLiveSessionLauncher({ spawn });
    await l.run("step 1", { sessionId: "s", resume: false });
    spawned[0].proc.close(); // process dies (restart/crash)
    await l.run("step 2", { sessionId: "s", resume: true });
    expect(spawned).toHaveLength(2);
    expect(spawned[1].resume).toBe(true); // recovery uses --resume
  });

  it("accumulates per-turn cost from result events", async () => {
    const { spawn } = fakeSpawn();
    const l = createLiveSessionLauncher({ spawn });
    await l.run("1", { sessionId: "s", resume: false });
    await l.run("2", { sessionId: "s", resume: true });
    expect(l.costOf("s")).toBeCloseTo(0.04);
  });

  it("streams assistant chunks to onChunk", async () => {
    const { spawn } = fakeSpawn();
    const l = createLiveSessionLauncher({ spawn });
    const chunks: string[] = [];
    await l.run("go", { sessionId: "s", resume: false, onChunk: (c) => chunks.push(c) });
    expect(chunks).toContain("hi");
  });
});
