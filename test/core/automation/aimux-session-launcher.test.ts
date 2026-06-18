import { describe, it, expect } from "vitest";
import { createAimuxLiveLauncher } from "../../../src/core/automation/aimux-session-launcher.js";

// A fake child process: on each stdin write it emits one success `result` event
// so launcher.run() resolves without spawning a real Claude process. Mirrors the
// shape the live launcher's attach() expects (stdout "data" + close/error).
function fakeProc() {
  let onData: ((d: string) => void) | undefined;
  return {
    stdin: {
      write: () => { queueMicrotask(() => onData?.(JSON.stringify({ type: "result", subtype: "success", result: "ok" }) + "\n")); },
      end: () => {},
    },
    stdout: { on: (_e: string, cb: (d: string) => void) => { onData = cb; } },
    on: () => {},
    kill: () => {},
  } as unknown as ReturnType<typeof import("node:child_process").spawn>;
}

const baseDeps = {
  loadConfig: (() => ({})) as never, // truthy cfg → passes the no-config guard
  profile: "p1",
  buildParams: (() => ({ cli: "node", args: [], env: {} })) as never,
  listMcp: () => [],
  spawnProcess: (() => fakeProc()) as never,
};

describe("createAimuxLiveLauncher — degradedOf (visible spawn-time failures)", () => {
  it("records a degraded marker when the MCP run-config write fails", async () => {
    const launcher = createAimuxLiveLauncher({
      ...baseDeps,
      writeMcpRunConfig: () => { throw new Error("EROFS: read-only file system"); },
    });
    await launcher.run("hello", { sessionId: "s1", resume: false });
    expect(launcher.degradedOf("s1")).toContain("MCP servers not loaded (config write failed)");
  });

  it("does not record the MCP marker when the run-config write succeeds", async () => {
    const launcher = createAimuxLiveLauncher({
      ...baseDeps,
      writeMcpRunConfig: () => null, // no servers → nothing written, no failure
    });
    await launcher.run("hello", { sessionId: "s2", resume: false });
    expect(launcher.degradedOf("s2")).not.toContain("MCP servers not loaded (config write failed)");
  });

  it("returns an empty list for a session that never ran", () => {
    const launcher = createAimuxLiveLauncher(baseDeps);
    expect(launcher.degradedOf("never")).toEqual([]);
  });
});
