// Loom conveyor demo — LIVE aimux variant. Same as conveyor-demo.mjs, but ONE
// stage (spec) runs a real aimux headless session instead of a canned response,
// proving a real agent executes inside the conveyor. Kept deliberately cheap:
// a single short prompt on a small model (haiku), capped to a one-line answer.
// Every other stage stays deterministic so total token spend is one tiny call.
//
// Run:  node demo/conveyor-demo-live.mjs   (after `npm run build:host`)
//   env: LOOM_DEMO_PROFILE (aimux subscription, default = first)
//        LOOM_DEMO_MODEL    (default = claude-haiku-4-5-20251001)

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, runProfileHeadless } from "@digital-threads/aimux/core";
import { listSubscriptions } from "../dist/core/plugins/aimux/adapter.js";
import { openStore, createTask, getTask, getStages } from "../dist/core/store/db.js";
import { startTask, boardColumns } from "../dist/core/pipeline/engine.js";
import { advanceTask } from "../dist/core/pipeline/conductor.js";
import { runAnalysis, acceptSpec } from "../dist/core/pipeline/stage-runners.js";
import { createArtifact, getArtifacts, latestArtifact } from "../dist/core/store/artifacts.js";
import { runPr, runDone } from "../dist/core/pipeline/pr-done.js";

const log = (...a) => console.log(...a);
const rule = (t) => log(`\n${"─".repeat(64)}\n${t}\n${"─".repeat(64)}`);
const git = (repo, ...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

// ── scratch git repo ─────────────────────────────────────────────────────────
const repo = mkdtempSync(join(tmpdir(), "loom-demo-repo-"));
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "demo@loom.dev");
git(repo, "config", "user.name", "Loom Demo");
writeFileSync(join(repo, "greet.js"), "export function greet(name) {\n  return name;\n}\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "chore: initial commit");
log(`scratch repo: ${repo}`);

// ── core store ───────────────────────────────────────────────────────────────
const db = openStore(join(mkdtempSync(join(tmpdir(), "loom-demo-store-")), "loom.db"), "demo-project");

// ── deterministic agent for the cheap stages (analysis classifier) ───────────
const cannedAgent = async () =>
  JSON.stringify({ class: "feature", route: ["analysis", "brainstorm", "spec", "rd", "impl", "review", "qa", "pr", "done"] });

// ── ONE real aimux call, used only by the spec stage ─────────────────────────
const profile = process.env.LOOM_DEMO_PROFILE || listSubscriptions()[0]?.name;
const model = process.env.LOOM_DEMO_MODEL || "claude-haiku-4-5-20251001";
async function liveSpec(brief) {
  const cfg = loadConfig();
  if (!cfg || !profile) return { text: "", live: false };
  const prompt =
    `In ONE short sentence (max 15 words), state the code change for: ${brief} ` +
    `Answer with the sentence only, no preamble.`;
  log(`  · spec: calling aimux headless (profile=${profile}, model=${model}) …`);
  const res = await runProfileHeadless(cfg, profile, { model, cwd: repo, extraArgs: ["-p", prompt] });
  return { text: (res.stdout || "").trim(), live: res.exitCode === 0 };
}

// ── task (autopilot) ─────────────────────────────────────────────────────────
const taskId = "demo-live-1";
createTask(db, {
  id: taskId,
  title: "Make greet() return a friendly greeting",
  repo,
  branch: "feat/friendly-greeting",
  description: 'greet(name) returns the bare name; it should return "Hello, <name>!".',
  run_mode: "autopilot",
});
startTask(db, taskId);

const featureBranch = "feat/friendly-greeting";
const runners = {
  analysis: async (_d, id) => {
    const r = await runAnalysis(db, id, getTask(db, id).description, cannedAgent);
    log(`  · analysis: "${r.class}", ${r.route.length} stages`);
    return { ok: true };
  },
  brainstorm: async (_d, id) => {
    createArtifact(db, { id: `art_${id}_brain`, taskId: id, stage: "brainstorm", kind: "brainstorm-summary", content: "Return `Hello, ${name}!`.", status: "accepted" });
    return { ok: true };
  },
  spec: async (_d, id) => {
    const { text, live } = await liveSpec(getTask(db, id).description);
    const content = text || "Return `Hello, ${name}!` from greet(name).";
    createArtifact(db, { id: `art_${id}_spec`, taskId: id, stage: "spec", kind: "spec-md", content, status: "draft" });
    acceptSpec(db, id);
    log(`  · spec: ${live ? "LIVE agent answer" : "fallback (aimux unavailable)"}: ${content}`);
    return { ok: true };
  },
  rd: async () => ({ ok: true }),
  impl: async () => {
    git(repo, "checkout", "-q", "-b", featureBranch);
    writeFileSync(join(repo, "greet.js"), "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "feat: greet() returns a friendly greeting");
    log(`  · impl: committed on ${featureBranch}`);
    return { ok: true };
  },
  review: async () => ({ ok: true }),
  qa: async () => ({ ok: readFileSync(join(repo, "greet.js"), "utf8").includes("Hello, ${name}!") }),
  pr: async (_d, id) => { runPr(db, id, {}); log("  · pr: description artifact created"); return { ok: true }; },
  done: async (_d, id) => { runDone(db, id, { projectId: "demo-project" }); log("  · done: task closed"); return { ok: true }; },
};

rule("RUN — conductor drives the task (autopilot, spec stage = live aimux)");
const result = await advanceTask(db, taskId, runners);
log(`\nstages run: ${result.ran.join(" → ")}`);
log(`stopped at: ${result.stoppedAt === null ? "Done" : result.stoppedAt}`);

rule("RESULT");
const task = getTask(db, taskId);
log(`task status: ${task.status}`);
log("stages: " + getStages(db, taskId).map((s) => `${s.stage_key}=${s.status}`).join(" "));
log("board Done column: " + (boardColumns(db).find((c) => c.stageKey === "done")?.cards.map((c) => c.id).join(", ") || "—"));
log("artifacts: " + getArtifacts(db, taskId).map((a) => `${a.kind}(${a.status})`).join(", "));
log("\nspec artifact (from the live agent):");
log("  " + (latestArtifact(db, taskId, "spec-md")?.content ?? "(none)"));
log(`\ngit diff main..${featureBranch}:`);
log(git(repo, "diff", "main", featureBranch, "--", "greet.js"));

db.close();
rmSync(repo, { recursive: true, force: true });
log(`\n✓ live demo complete — task reached "${task.status}".`);
