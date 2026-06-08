import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { withTempHome, recordingRun } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("e2e helpers", () => {
  it("withTempHome ставит HOME/XDG внутрь временного корня и убирает за собой", () => {
    const t = withTempHome();
    cleanups.push(t.cleanup);
    expect(t.env.HOME.startsWith(t.root)).toBe(true);
    expect(t.env.XDG_DATA_HOME.startsWith(t.root)).toBe(true);
    expect(t.env.XDG_CONFIG_HOME.startsWith(t.root)).toBe(true);
    expect(existsSync(t.env.HOME)).toBe(true);
  });

  it("recordingRun пишет вызовы и не исполняет ничего", () => {
    const { run, calls } = recordingRun({
      npm: { ok: true, stdout: "demo-1.0.0.tgz", stderr: "" },
    });
    const r = run("npm", ["pack", "demo"]);
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("tgz");
    // дефолтный успех для неизвестной команды — по фактической форме CmdResult.
    const d = run("git", ["clone", "x"]);
    expect(d).toEqual({ ok: true, stdout: "", stderr: "" });
    expect(calls).toEqual([
      ["npm", "pack", "demo"],
      ["git", "clone", "x"],
    ]);
  });
});
