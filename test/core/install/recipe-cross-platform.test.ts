import { describe, expect, it } from "vitest";
import { runRecipe, detect, resolveProbeCmd, resolveLauncher } from "../../../src/core/install/recipe.js";
import type { CmdRunner, InstallDeps } from "../../../src/core/install/types.js";

function fake() {
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => { calls.push([cmd, ...args]); return { ok: true, stdout: "", stderr: "" }; };
  return { run, calls };
}
const deps = (run: CmdRunner): InstallDeps => ({ dataDir: "/tmp/x", run });

describe("resolveProbeCmd", () => {
  it("which→where on win32, unchanged on linux", () => {
    expect(resolveProbeCmd("which", "win32")).toBe("where");
    expect(resolveProbeCmd("which", "linux")).toBe("which");
    expect(resolveProbeCmd("npm", "win32")).toBe("npm.cmd");
  });
});

describe("resolveLauncher", () => {
  it("npm/cargo/claude → *.cmd on win32, as-is on unix", () => {
    expect(resolveLauncher("npm", "win32")).toBe("npm.cmd");
    expect(resolveLauncher("cargo", "win32")).toBe("cargo.cmd");
    expect(resolveLauncher("claude", "win32")).toBe("claude.cmd");
    expect(resolveLauncher("npm", "linux")).toBe("npm");
    expect(resolveLauncher("npm", "darwin")).toBe("npm");
  });
  it("leaves non-wrapper cmds untouched (even on win32)", () => {
    expect(resolveLauncher("git", "win32")).toBe("git");
  });
});

describe("runRecipe — cross-platform execution", () => {
  it("win32: npm → npm.cmd, which → where", () => {
    const { run, calls } = fake();
    runRecipe(
      [{ cmd: "npm", args: ["install","-g","x"] }, { cmd: "which", args: ["x"] }],
      { scope: "user", platform: "win32" }, deps(run));
    expect(calls).toEqual([["npm.cmd","install","-g","x"], ["where","x"]]);
  });
  it("linux: commands are not rewritten", () => {
    const { run, calls } = fake();
    runRecipe([{ cmd: "npm", args: ["i","-g","x"] }, { cmd: "which", args: ["x"] }],
      { scope: "user", platform: "linux" }, deps(run));
    expect(calls).toEqual([["npm","i","-g","x"], ["which","x"]]);
  });
});

describe("detect — cross-platform probe", () => {
  it("win32: probe which→where before running", () => {
    const { run, calls } = fake();
    detect({ probe: { cmd: "which", args: ["aimux"] } }, deps(run), "win32");
    expect(calls).toEqual([["where","aimux"]]);
  });
});
