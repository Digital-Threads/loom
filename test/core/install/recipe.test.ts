import { describe, expect, it } from "vitest";
import { runRecipe, isValidScope, substituteScope } from "../../../src/core/install/recipe.js";
import type { CmdRunner, InstallDeps } from "../../../src/core/install/types.js";

function fake(results: Record<string, { ok: boolean; stdout?: string; stderr?: string }> = {}) {
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(" ");
    return { ok: results[key]?.ok ?? true, stdout: results[key]?.stdout ?? "", stderr: results[key]?.stderr ?? "" };
  };
  return { run, calls };
}
const deps = (run: CmdRunner): InstallDeps => ({ dataDir: "/tmp/x", run });

describe("substituteScope", () => {
  it("replaces {scope} with the real scope", () => {
    expect(substituteScope(["install","--scope","{scope}","x"], "project"))
      .toEqual(["install","--scope","project","x"]);
  });
  it("no placeholder — no changes", () => {
    expect(substituteScope(["i","-g","x"], "user")).toEqual(["i","-g","x"]);
  });
});

describe("isValidScope", () => {
  it("user/project — ok; anything else — no", () => {
    expect(isValidScope("user")).toBe(true);
    expect(isValidScope("project")).toBe(true);
    expect(isValidScope("--evil")).toBe(false);
  });
});

describe("runRecipe", () => {
  it("runs the steps in order, substitutes scope", () => {
    const { run, calls } = fake();
    const r = runRecipe(
      [{ cmd: "npm", args: ["i","-g","x"] }, { cmd: "claude", args: ["plugin","install","--scope","{scope}","x@x"], scoped: true }],
      { scope: "project" }, deps(run));
    expect(r.ok).toBe(true);
    expect(calls).toEqual([["npm","i","-g","x"], ["claude","plugin","install","--scope","project","x@x"]]);
  });
  it("required step failure → ok:false, does not continue", () => {
    const { run, calls } = fake({ "npm i -g x": { ok: false, stderr: "boom" } });
    const r = runRecipe([{ cmd:"npm", args:["i","-g","x"] }, { cmd:"claude", args:["a"] }], { scope: "user" }, deps(run));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
    expect(calls).toEqual([["npm","i","-g","x"]]);
  });
  it("optional step failure → ok:true + warning, continues", () => {
    const { run, calls } = fake({ "cargo uninstall y": { ok: false, stderr: "no crate" } });
    const r = runRecipe([{ cmd:"cargo", args:["uninstall","y"], optional:true }, { cmd:"claude", args:["b"] }], { scope:"user" }, deps(run));
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/no crate/);
    expect(calls.length).toBe(2);
  });
  it("dryRun → runs nothing, lists the commands", () => {
    const { run, calls } = fake();
    const r = runRecipe([{ cmd:"npm", args:["i","-g","x"] }], { scope:"user", dryRun: true }, deps(run));
    expect(r.ok).toBe(true);
    expect(calls).toEqual([]);
    expect(r.planned).toEqual([["npm","i","-g","x"]]);
  });
});

describe("runRecipe — interactive (semi-auto)", () => {
  it("interactive step is NOT executed, goes to manual, the recipe does not fail", () => {
    const { run, calls } = fake();
    const r = runRecipe(
      [{ cmd: "npm", args: ["i","-g","aimux"] },
       { cmd: "aimux", args: ["auth","login"], interactive: true }],
      { scope: "user" }, deps(run));
    expect(r.ok).toBe(true);
    expect(calls).toEqual([["npm","i","-g","aimux"]]);
    expect(r.manual).toEqual([["aimux","auth","login"]]);
  });
  it("interactive with scope: the scope is substituted into manual", () => {
    const { run } = fake();
    const r = runRecipe(
      [{ cmd: "claude", args: ["auth","login","--scope","{scope}"], interactive: true, scoped: true }],
      { scope: "project" }, deps(run));
    expect(r.ok).toBe(true);
    expect(r.manual).toEqual([["claude","auth","login","--scope","project"]]);
  });
  it("interactive only → ok:true, calls empty, everything in manual", () => {
    const { run, calls } = fake();
    const r = runRecipe([{ cmd: "claude", args: ["auth","login"], interactive: true }], { scope: "user" }, deps(run));
    expect(r.ok).toBe(true);
    expect(calls).toEqual([]);
    expect(r.manual?.length).toBe(1);
  });
  it("dryRun: interactive goes to manual, auto goes to planned", () => {
    const { run } = fake();
    const r = runRecipe(
      [{ cmd: "npm", args: ["i","x"] }, { cmd: "aimux", args: ["auth","login"], interactive: true }],
      { scope: "user", dryRun: true }, deps(run));
    expect(r.planned).toEqual([["npm","i","x"]]);
    expect(r.manual).toEqual([["aimux","auth","login"]]);
  });
});
