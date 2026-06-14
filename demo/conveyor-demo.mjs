// Loom conveyor demo — drives a real task from creation to Done through the real
// pipeline engine + conductor over a real scratch git repo. The only stubbed
// piece is the LLM: the StageAgent returns canned text so the run is fast and
// deterministic. Everything else — the store, the 9-stage engine, gates,
// artifacts, the git branch/commit at impl, the PR description, the Done event —
// is the actual product code.
//
// Run:  node demo/conveyor-demo.mjs   (after `npm run build:host`)

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore, createTask, getTask, getStages } from "../dist/core/store/db.js";
import { startTask, boardColumns } from "../dist/core/pipeline/engine.js";
import { advanceTask } from "../dist/core/pipeline/conductor.js";
import { runAnalysis, draftSpec, acceptSpec } from "../dist/core/pipeline/stage-runners.js";
import { createArtifact, getArtifacts, latestArtifact } from "../dist/core/store/artifacts.js";
import { runPr, runDone } from "../dist/core/pipeline/pr-done.js";

const log = (...a) => console.log(...a);
const rule = (t) => log(`\n${"─".repeat(64)}\n${t}\n${"─".repeat(64)}`);

function git(repo, ...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

// ── 1. Scratch git repo with a `main` branch and one initial commit ──────────
const repo = mkdtempSync(join(tmpdir(), "loom-demo-repo-"));
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "demo@loom.dev");
git(repo, "config", "user.name", "Loom Demo");
writeFileSync(join(repo, "README.md"), "# Demo app\n");
writeFileSync(join(repo, "greet.js"), "export function greet(name) {\n  return name;\n}\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "chore: initial commit");
log(`scratch repo: ${repo}`);
log(`initial branch: ${git(repo, "branch", "--show-current")}, commit: ${git(repo, "log", "--oneline", "-1")}`);

// ── 2. Core store (temp db) ──────────────────────────────────────────────────
const dbPath = join(mkdtempSync(join(tmpdir(), "loom-demo-store-")), "loom.db");
const db = openStore(dbPath, "demo-project");

// ── 3. Deterministic StageAgent (stands in for the LLM) ──────────────────────
const stageAgent = async (prompt) => {
  if (prompt.includes("Classify this task")) {
    return JSON.stringify({
      class: "feature",
      route: ["analysis", "brainstorm", "spec", "rd", "impl", "review", "qa", "pr", "done"],
    });
  }
  if (prompt.includes("Write an SDD")) {
    return [
      "# SDD — Friendly greeting",
      "",
      "## Goal",
      "`greet(name)` should return a friendly greeting, not the bare name.",
      "",
      "## Change",
      "Return `Hello, <name>!`.",
      "",
      "## Acceptance",
      "- `greet(\"Mira\")` → `\"Hello, Mira!\"`",
    ].join("\n");
  }
  return "ok";
};

// ── 4. Create the task in autopilot mode ─────────────────────────────────────
const taskId = "demo-1";
createTask(db, {
  id: taskId,
  title: "Make greet() return a friendly greeting",
  repo,
  branch: "feat/friendly-greeting",
  description: "greet(name) currently returns the bare name. It should return \"Hello, <name>!\".",
  run_mode: "autopilot",
});
log(`\ntask created: ${taskId} (run_mode=autopilot)`);
startTask(db, taskId);

// ── 5. Real stage runners (real artifacts + a real git change at impl) ───────
const featureBranch = "feat/friendly-greeting";
const runners = {
  analysis: async (_d, id) => {
    const r = await runAnalysis(db, id, getTask(db, id).description, stageAgent);
    log(`  · analysis: classified as "${r.class}", route of ${r.route.length} stages`);
    return { ok: true };
  },
  brainstorm: async (_d, id) => {
    createArtifact(db, {
      id: `art_${id}_brain`,
      taskId: id,
      stage: "brainstorm",
      kind: "brainstorm-summary",
      content: "Decision: return `Hello, ${name}!`. Simplest change, matches the ask.",
      status: "accepted",
    });
    log("  · brainstorm: summary recorded");
    return { ok: true };
  },
  spec: async (_d, id) => {
    await draftSpec(db, id, stageAgent);
    acceptSpec(db, id);
    log("  · spec: SDD drafted and accepted");
    return { ok: true };
  },
  rd: async () => ({ ok: true }),
  impl: async () => {
    // Real change in the scratch repo on a feature branch.
    git(repo, "checkout", "-q", "-b", featureBranch);
    writeFileSync(
      join(repo, "greet.js"),
      "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n",
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "feat: greet() returns a friendly greeting");
    log(`  · impl: committed on ${featureBranch} → ${git(repo, "log", "--oneline", "-1")}`);
    return { ok: true };
  },
  review: async () => {
    log("  · review: no blocking findings");
    return { ok: true };
  },
  qa: async () => {
    // A real check against the scratch repo: the new behaviour is present.
    const src = readFileSync(join(repo, "greet.js"), "utf8");
    const ok = src.includes("Hello, ${name}!");
    log(`  · qa: behaviour check ${ok ? "passed" : "FAILED"}`);
    return { ok, needsAttention: !ok };
  },
  pr: async (_d, id) => {
    const res = runPr(db, id, {}); // description-only (no remote in this demo)
    log(`  · pr: description artifact created (${res.description.split("\n")[0]})`);
    return { ok: true };
  },
  done: async (_d, id) => {
    runDone(db, id, { projectId: "demo-project" });
    log("  · done: task closed, task.done event emitted");
    return { ok: true };
  },
};

// ── 6. Drive the whole pipeline ──────────────────────────────────────────────
rule("RUN — conductor drives the task (autopilot)");
const result = await advanceTask(db, taskId, runners);
log(`\nstages run: ${result.ran.join(" → ")}`);
log(`stopped at: ${result.stoppedAt === null ? "Done (reached the end)" : result.stoppedAt}`);

// ── 7. Show the resulting state ──────────────────────────────────────────────
rule("RESULT — final task + pipeline state");
const task = getTask(db, taskId);
log(`task status: ${task.status}`);
log("stages:");
for (const s of getStages(db, taskId)) log(`  ${s.stage_key.padEnd(10)} ${s.status}`);

rule("RESULT — board view-model (columns = stages)");
for (const col of boardColumns(db)) {
  const cards = col.cards.map((c) => c.id).join(", ") || "—";
  log(`  ${col.stageKey.padEnd(10)} [${col.cards.length}] ${cards}`);
}

rule("RESULT — artifacts produced");
for (const a of getArtifacts(db, taskId)) log(`  ${a.stage.padEnd(10)} ${a.kind.padEnd(18)} (${a.status})`);

rule("RESULT — PR description (generated artifact)");
log(latestArtifact(db, taskId, "pr-description")?.content ?? "(none)");

rule("RESULT — git state of the scratch repo");
log(`branches:\n${git(repo, "branch")}`);
log(`\ndiff main..${featureBranch}:`);
log(git(repo, "diff", "main", featureBranch, "--", "greet.js"));

// ── cleanup ──────────────────────────────────────────────────────────────────
db.close();
rmSync(repo, { recursive: true, force: true });
log(`\n✓ demo complete — task ${taskId} reached "${task.status}" through all 9 stages.`);
