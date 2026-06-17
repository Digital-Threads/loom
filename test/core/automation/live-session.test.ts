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

  it("passes bypassPermissions through to spawn (autopilot full access)", async () => {
    const seen: Array<boolean | undefined> = [];
    const spawn: SpawnSession = ({ bypassPermissions }) => {
      seen.push(bypassPermissions);
      let onData: ((d: string) => void) | undefined;
      return {
        stdin: { write: () => queueMicrotask(() => onData?.(JSON.stringify({ type: "result", subtype: "success", result: "ok" }) + "\n")), end: () => {} },
        stdout: { on: (_e, cb) => { onData = cb as (d: string) => void; } },
        on: () => {}, kill: () => {},
      };
    };
    const l = createLiveSessionLauncher({ spawn });
    await l.run("go", { sessionId: "s1", resume: false, bypassPermissions: true });
    await l.run("go", { sessionId: "s2", resume: false, bypassPermissions: false });
    expect(seen).toEqual([true, false]);
  });

  it("interject writes a user message into the live process stdin (intervene)", async () => {
    const writes: string[] = [];
    const spawn: SpawnSession = () => {
      let onData: ((d: string) => void) | undefined;
      return {
        stdin: { write: (s: string) => { writes.push(s); queueMicrotask(() => onData?.(JSON.stringify({ type: "result", subtype: "success", result: "ok" }) + "\n")); }, end: () => {} },
        stdout: { on: (_e, cb) => { onData = cb as (d: string) => void; } },
        on: () => {}, kill: () => {},
      };
    };
    const l = createLiveSessionLauncher({ spawn });
    await l.run("step", { sessionId: "s", resume: false }); // creates the live process
    expect(l.interject("s", "use the cache instead")).toBe(true);
    expect(writes.some((w) => w.includes("use the cache instead"))).toBe(true);
    expect(l.interject("nope", "x")).toBe(false); // no live process
  });

  it("streams assistant chunks to onChunk", async () => {
    const { spawn } = fakeSpawn();
    const l = createLiveSessionLauncher({ spawn });
    const chunks: string[] = [];
    await l.run("go", { sessionId: "s", resume: false, onChunk: (c) => chunks.push(c) });
    expect(chunks).toContain("hi");
  });

  it("streams tool activity (so a long tool-heavy stage isn't silent)", async () => {
    // a fake that emits a tool_use block (no text) then a result
    const spawn: SpawnSession = () => {
      let onData: ((d: string) => void) | undefined;
      return {
        stdin: {
          write: () => queueMicrotask(() => {
            onData?.(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/x.ts" } }] } }) + "\n");
            onData?.(JSON.stringify({ type: "result", subtype: "success", result: "ok" }) + "\n");
          }),
          end: () => {},
        },
        stdout: { on: (_e: "data", cb: (d: string | Buffer) => void) => { onData = cb as (d: string) => void; } },
        on: () => {},
        kill: () => {},
      } as ProcLike;
    };
    const l = createLiveSessionLauncher({ spawn });
    const chunks: string[] = [];
    await l.run("impl", { sessionId: "s", resume: false, onChunk: (c) => chunks.push(c) });
    expect(chunks.join("\n")).toContain("→ Edit: src/x.ts");
  });

  it("times out and kills the session when the agent never replies (loom-uxjk)", async () => {
    let killed = false;
    const spawn: SpawnSession = () => ({
      stdin: { write: () => {}, end: () => {} },
      stdout: { on: () => {} },
      on: () => {},
      kill: () => { killed = true; },
    } as unknown as ProcLike);
    const l = createLiveSessionLauncher({ spawn, replyTimeoutMs: 30 });
    const r = await l.run("hi", { sessionId: "s", resume: false });
    expect(r.text).toMatch(/did not respond/);
    expect(killed).toBe(true);
  });

  it("settles the awaiting send when the process dies before replying", async () => {
    let onClose: (() => void) | undefined;
    const spawn: SpawnSession = () => ({
      stdin: { write: () => {}, end: () => {} },
      stdout: { on: () => {} },
      on: (e: "close" | "error", cb: () => void) => { if (e === "close") onClose = cb; },
      kill: () => {},
    } as unknown as ProcLike);
    const l = createLiveSessionLauncher({ spawn, replyTimeoutMs: 5000 });
    const p = l.run("hi", { sessionId: "s", resume: false });
    setTimeout(() => onClose?.(), 10);
    const r = await p;
    expect(r.text).toMatch(/ended before replying/);
  });
});
