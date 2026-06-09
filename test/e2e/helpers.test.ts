import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { withTempHome, recordingRun } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("e2e helpers", () => {
  it("withTempHome points HOME/XDG inside a temp root and cleans up after itself", () => {
    const t = withTempHome();
    cleanups.push(t.cleanup);
    expect(t.env.HOME.startsWith(t.root)).toBe(true);
    expect(t.env.XDG_DATA_HOME.startsWith(t.root)).toBe(true);
    expect(t.env.XDG_CONFIG_HOME.startsWith(t.root)).toBe(true);
    expect(existsSync(t.env.HOME)).toBe(true);
  });

  it("recordingRun records calls and executes nothing", () => {
    const { run, calls } = recordingRun({
      npm: { ok: true, stdout: "demo-1.0.0.tgz", stderr: "" },
    });
    const r = run("npm", ["pack", "demo"]);
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("tgz");
    // default success for an unknown command — matching the actual CmdResult shape.
    const d = run("git", ["clone", "x"]);
    expect(d).toEqual({ ok: true, stdout: "", stderr: "" });
    expect(calls).toEqual([
      ["npm", "pack", "demo"],
      ["git", "clone", "x"],
    ]);
  });
});
