import { describe, it, expect } from "vitest";
import { createAuthManager, type ProcLike } from "../../src/core/plugins/aimux/auth-login.js";

function fakeProc() {
  let dataCb: ((d: string) => void) | null = null;
  const handlers: Record<string, (a?: unknown) => void> = {};
  const writes: string[] = [];
  const proc: ProcLike = {
    stdout: { on: (_e, cb) => { dataCb = cb as (d: string) => void; } },
    stdin: { write: (s) => { writes.push(s); } },
    on: (e, cb) => { handlers[e] = cb; },
    kill: () => {},
  };
  return { proc, emit: (d: string) => dataCb?.(d), exit: () => handlers.exit?.(), writes };
}

const URL = "https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y";

describe("auth-login manager", () => {
  it("parses the auth URL and moves to awaiting_code", () => {
    const f = fakeProc();
    const mgr = createAuthManager({ spawnAuth: () => f.proc, profilePath: () => "/p", credsExist: () => false });
    const id = mgr.start("test");
    expect(mgr.get(id)).toMatchObject({ status: "starting", authorized: false });
    f.emit(`Opening browser to sign in…\nIf the browser didn't open, visit: ${URL}\nPaste code here if prompted > `);
    expect(mgr.get(id)).toMatchObject({ status: "awaiting_code", url: URL });
  });

  it("writes the pasted code (trimmed) + newline to stdin", () => {
    const f = fakeProc();
    const mgr = createAuthManager({ spawnAuth: () => f.proc, profilePath: () => "/p", credsExist: () => false });
    const id = mgr.start("test");
    expect(mgr.submitCode(id, "  abc123  ")).toBe(true);
    expect(f.writes).toEqual(["abc123\n"]);
    expect(mgr.submitCode("nope", "x")).toBe(false);
  });

  it("exit with credentials → done/authorized; without → error", () => {
    const ok = fakeProc();
    const mgrOk = createAuthManager({ spawnAuth: () => ok.proc, profilePath: () => "/p", credsExist: () => true });
    const a = mgrOk.start("test");
    ok.exit();
    expect(mgrOk.get(a)).toMatchObject({ status: "done", authorized: true });

    const bad = fakeProc();
    const mgrBad = createAuthManager({ spawnAuth: () => bad.proc, profilePath: () => "/p", credsExist: () => false });
    const b = mgrBad.start("test");
    bad.exit();
    expect(mgrBad.get(b)).toMatchObject({ status: "error", authorized: false });
  });

  it("get/cancel on unknown id is safe", () => {
    const mgr = createAuthManager({ spawnAuth: () => fakeProc().proc, profilePath: () => "/p", credsExist: () => false });
    expect(mgr.get("missing")).toBeNull();
    expect(() => mgr.cancel("missing")).not.toThrow();
  });
});
