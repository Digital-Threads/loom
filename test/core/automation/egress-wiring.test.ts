import { describe, it, expect } from "vitest";
import { createAimuxLiveLauncher } from "../../../src/core/automation/aimux-session-launcher.js";

// A launcher whose openSession captures the env handed to the session, plus
// whatever extra deps the test needs (sandbox flag, fake egress proxy).
function launcherWithCapture(extra: Record<string, unknown>) {
  let env: Record<string, string> | undefined;
  const openSession = ((_c: unknown, _p: string, o: { env?: Record<string, string> }) => {
    env = o.env;
    return {
      send: async () => ({ text: "ok", costUsd: 0, denials: [] }),
      interject: () => false, relocate: () => {}, cost: () => 0, denials: () => [], close: () => {},
    };
  }) as never;
  const launcher = createAimuxLiveLauncher({
    loadConfig: (() => ({})) as never, // truthy cfg → passes the no-config guard
    profile: "p1",
    openSession,
    listMcp: () => [],
    ...extra,
  });
  return { launcher, env: () => env };
}

describe("egress audit wiring (Phase 1)", () => {
  it("routes a sandboxed session through the egress proxy (HTTPS_PROXY → proxy port)", async () => {
    let closed = false;
    const { launcher, env } = launcherWithCapture({
      sandbox: true,
      detectSandbox: () => "none", // egress works even with no write-confinement backend
      startEgressProxy: async () => ({ port: 51234, close: () => { closed = true; } }),
    });
    await launcher.run("hi", {
      sessionId: "s1", resume: false, sandbox: true,
      env: { LOOM_PROJECT_ID: "p1", LOOM_TASK_ID: "t1" },
    });
    expect(env()?.HTTPS_PROXY).toBe("http://127.0.0.1:51234");
    expect(env()?.HTTP_PROXY).toBe("http://127.0.0.1:51234");
    expect(env()?.NO_PROXY).toContain("127.0.0.1");
    expect(env()?.LOOM_TASK_ID).toBe("t1"); // spine env preserved alongside the proxy vars

    (launcher as unknown as { stop: (id: string) => void }).stop("s1");
    expect(closed).toBe(true); // the proxy is closed when the session stops
  });

  it("leaves the network untouched when the sandbox is off (no proxy env)", async () => {
    const { launcher, env } = launcherWithCapture({ sandbox: false });
    await launcher.run("hi", { sessionId: "s2", resume: false, sandbox: false, env: { LOOM_TASK_ID: "t2" } });
    expect(env()?.HTTPS_PROXY).toBeUndefined();
    expect(env()?.LOOM_TASK_ID).toBe("t2");
  });

  it("passes an allow predicate to the proxy when egress enforcement is on (and not when off)", async () => {
    const optsSeen: Array<{ allow?: unknown }> = [];
    const mk = (enforce: boolean) => createAimuxLiveLauncher({
      loadConfig: (() => ({})) as never, profile: "p1", listMcp: () => [],
      openSession: (() => ({ send: async () => ({ text: "ok", costUsd: 0, denials: [] }), interject: () => false, relocate: () => {}, cost: () => 0, denials: () => [], close: () => {} })) as never,
      sandbox: true, detectSandbox: () => "none",
      egressPolicy: () => ({ enforce, allow: ["github.com"] }),
      startEgressProxy: (async (o: { allow?: unknown }) => { optsSeen.push(o); return { port: 1, close: () => {} }; }) as never,
    });

    await mk(true).run("hi", { sessionId: "e1", resume: false, sandbox: true, env: {} });
    expect(typeof optsSeen[0].allow).toBe("function"); // enforce on → allowlist predicate wired

    await mk(false).run("hi", { sessionId: "e2", resume: false, sandbox: true, env: {} });
    expect(optsSeen[1].allow).toBeUndefined(); // enforce off → observe-only, no predicate
  });
});
