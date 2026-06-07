import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRecipe, detect } from "../../../src/core/install/recipe.js";
import { validateManifest } from "../../../src/core/plugins/manifest.js";

const PKGS = join(__dirname, "../../../packages");
function recipe(name: string) {
  const m = JSON.parse(readFileSync(join(PKGS, `loom-plugin-${name}`, "plugin.json"), "utf8"));
  const v = validateManifest(m);
  if (!v.ok) throw new Error(v.error);
  return v.manifest.install!;
}
function fake() {
  const calls: string[][] = [];
  return { run: (c: string, a: string[]) => { calls.push([c, ...a]); return { ok: true, stdout: "", stderr: "" }; }, calls };
}
const deps = (run: any) => ({ dataDir: "/tmp", run });

it("aimux: install = npm -g, scope не нужен", () => {
  const { run, calls } = fake();
  expect(runRecipe(recipe("aimux").install, { scope: "user" }, deps(run)).ok).toBe(true);
  expect(calls).toContainEqual(["npm","install","-g","@digital-threads/aimux"]);
});

it("token-pilot: install = marketplace add + claude install со scope", () => {
  const { run, calls } = fake();
  runRecipe(recipe("token-pilot").install, { scope: "project" }, deps(run));
  expect(calls).toContainEqual(["claude","plugin","install","--scope","project","token-pilot@token-pilot"]);
});

it("task-journal: install = cargo + claude install", () => {
  const { run, calls } = fake();
  runRecipe(recipe("task-journal").install, { scope: "user" }, deps(run));
  expect(calls.some((c) => c[0] === "cargo" && c[1] === "install")).toBe(true);
  expect(calls).toContainEqual(["claude","plugin","install","--scope","user","task-journal@task-journal"]);
});

it("detect возвращает installed=true когда probe.ok", () => {
  const run = () => ({ ok: true, stdout: "@digital-threads/aimux@1.2.3", stderr: "" });
  expect(detect(recipe("aimux").detect, deps(run)).installed).toBe(true);
});

it("remove гоняет команды снятия", () => {
  for (const name of ["aimux","token-pilot","task-journal"]) {
    const { run, calls } = fake();
    runRecipe(recipe(name).remove, { scope: "user" }, deps(run));
    expect(calls.length).toBeGreaterThan(0);
  }
});
