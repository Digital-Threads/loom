import { expect, it } from "vitest";
import { runRecipe, detect } from "../../../src/core/install/recipe.js";
import { validateManifest } from "../../../src/core/plugins/manifest.js";
import aimuxManifest from "../../../src/core/plugins/aimux/plugin.json" with { type: "json" };
import tokenPilotManifest from "../../../src/core/plugins/token-pilot/plugin.json" with { type: "json" };
import taskJournalManifest from "../../../src/core/plugins/task-journal/plugin.json" with { type: "json" };

const MANIFESTS: Record<string, unknown> = {
  aimux: aimuxManifest,
  "token-pilot": tokenPilotManifest,
  "task-journal": taskJournalManifest,
};
function recipe(name: string) {
  const v = validateManifest(MANIFESTS[name]);
  if (!v.ok) throw new Error(v.error);
  return v.manifest.install!;
}
function fake() {
  const calls: string[][] = [];
  return { run: (c: string, a: string[]) => { calls.push([c, ...a]); return { ok: true, stdout: "", stderr: "" }; }, calls };
}
const deps = (run: any) => ({ dataDir: "/tmp", run });

it("aimux: install = npm -g, no scope needed", () => {
  const { run, calls } = fake();
  expect(runRecipe(recipe("aimux").install, { scope: "user" }, deps(run)).ok).toBe(true);
  expect(calls).toContainEqual(["npm","install","-g","@digital-threads/aimux"]);
});

it("token-pilot: install = marketplace add + claude install with scope", () => {
  const { run, calls } = fake();
  runRecipe(recipe("token-pilot").install, { scope: "project" }, deps(run));
  expect(calls).toContainEqual(["claude","plugin","install","--scope","project","token-pilot@token-pilot"]);
});

it("task-journal: install = prebuilt binaries (fetchRelease) + claude install, no Rust", () => {
  const { run, calls } = fake();
  let fetched: any = null;
  const d = { dataDir: "/tmp", run, fetchRelease: (spec: any) => { fetched = spec; return { ok: true }; } };
  expect(runRecipe(recipe("task-journal").install, { scope: "user" }, d).ok).toBe(true);
  expect(fetched).toMatchObject({ repo: "Digital-Threads/Task-Journal", bins: ["task-journal", "task-journal-mcp"] });
  expect(calls.some((c) => c[0] === "cargo")).toBe(false); // no build-from-source
  expect(calls).toContainEqual(["claude","plugin","install","--scope","user","task-journal@task-journal"]);
});

it("detect returns installed=true when probe.ok", () => {
  const run = () => ({ ok: true, stdout: "@digital-threads/aimux@1.2.3", stderr: "" });
  expect(detect(recipe("aimux").detect, deps(run)).installed).toBe(true);
});

it("remove runs the uninstall commands", () => {
  for (const name of ["aimux","token-pilot","task-journal"]) {
    const { run, calls } = fake();
    runRecipe(recipe(name).remove, { scope: "user" }, deps(run));
    expect(calls.length).toBeGreaterThan(0);
  }
});
