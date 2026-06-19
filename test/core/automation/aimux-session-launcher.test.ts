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
