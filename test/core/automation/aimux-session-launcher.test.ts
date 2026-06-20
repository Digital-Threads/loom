import { describe, it, expect } from "vitest";
import { createAimuxLiveLauncher } from "../../../src/core/automation/aimux-session-launcher.js";

// A fake aimux live session: each send resolves immediately, so launcher.run()
// completes without opening a real Claude process.
function fakeSession() {
  return {
    send: async () => ({ text: "ok", costUsd: 0, denials: [] }),
    interject: () => false,
    relocate: () => {},
    cost: () => 0,
    denials: () => [],
    close: () => {},
  };
}

const baseDeps = {
  loadConfig: (() => ({})) as never, // truthy cfg → passes the no-config guard
  profile: "p1",
  openSession: (() => fakeSession()) as never,
  listMcp: () => [],
};

describe("createAimuxLiveLauncher — degradedOf (visible open-time failures)", () => {
  it("records a degraded marker when the MCP run-config write fails", async () => {
    const launcher = createAimuxLiveLauncher({
      ...baseDeps,
      writeMcpRunConfig: () => { throw new Error("EROFS: read-only file system"); },
    });
    await launcher.run("hello", { sessionId: "s1", resume: false });
    expect(launcher.degradedOf!("s1")).toContain("MCP servers not loaded (config write failed)");
  });

  it("does not record the MCP marker when the run-config write succeeds", async () => {
    const launcher = createAimuxLiveLauncher({
      ...baseDeps,
      writeMcpRunConfig: () => null, // no servers → nothing written, no failure
    });
    await launcher.run("hello", { sessionId: "s2", resume: false });
    expect(launcher.degradedOf!("s2")).not.toContain("MCP servers not loaded (config write failed)");
  });

  it("returns an empty list for a session that never ran", () => {
    const launcher = createAimuxLiveLauncher(baseDeps);
    expect(launcher.degradedOf!("never")).toEqual([]);
  });
});

describe("createAimuxLiveLauncher — OS sandbox", () => {
  it("wraps the agent spawn in bubblewrap when sandbox is requested and a backend exists", async () => {
    let captured: { spawnFn?: (c: string, a: string[], o: { cwd?: string }) => unknown } = {};
    const spawned: { cli: string; args: string[] }[] = [];
    const launcher = createAimuxLiveLauncher({
      ...baseDeps,
      openSession: ((_c: unknown, _p: unknown, o: typeof captured) => { captured = o; return fakeSession(); }) as never,
      detectSandbox: () => "bubblewrap",
      spawnProcess: ((cli: string, args: string[]) => { spawned.push({ cli, args }); return {}; }) as never,
    });
    await launcher.run("hi", { sessionId: "sb1", resume: false, sandbox: true });
    // aimux was handed a wrapping spawnFn; invoke it the way aimux would.
    captured.spawnFn!("claude", ["-p", "--resume", "x"], { cwd: "/wt" });
    expect(spawned[0].cli).toBe("bwrap");
    expect(spawned[0].args.join(" ")).toContain("--bind /wt /wt"); // worktree writable
    const sep = spawned[0].args.indexOf("--");
    expect(spawned[0].args.slice(sep + 1)).toEqual(["claude", "-p", "--resume", "x"]); // real cmd preserved
    expect(launcher.degradedOf!("sb1")).toEqual([]); // sandboxed → no degradation
  });

  it("records a degraded marker when sandbox is requested but no backend exists", async () => {
    const launcher = createAimuxLiveLauncher({ ...baseDeps, detectSandbox: () => "none" });
    await launcher.run("hi", { sessionId: "sb2", resume: false, sandbox: true });
    expect(launcher.degradedOf!("sb2")).toContain(
      "OS sandbox unavailable (install bubblewrap) — agent ran without write-confinement",
    );
  });

  it("does not wrap the spawn when sandbox is not requested (passthrough)", async () => {
    let captured: { spawnFn?: (c: string, a: string[], o: { cwd?: string }) => unknown } = {};
    const spawned: { cli: string }[] = [];
    const launcher = createAimuxLiveLauncher({
      ...baseDeps,
      openSession: ((_c: unknown, _p: unknown, o: typeof captured) => { captured = o; return fakeSession(); }) as never,
      detectSandbox: () => "bubblewrap", // available, but not requested
      spawnProcess: ((cli: string) => { spawned.push({ cli }); return {}; }) as never,
    });
    await launcher.run("hi", { sessionId: "sb3", resume: false }); // sandbox omitted
    captured.spawnFn!("claude", ["-p"], { cwd: "/wt" });
    expect(spawned[0].cli).toBe("claude"); // unwrapped
    expect(launcher.degradedOf!("sb3")).toEqual([]);
  });
});
