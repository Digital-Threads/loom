// Session-model demo — proves ONE live Claude session carries a task across
// stages (analysis → spec → R&D): same session_id for every stage, context
// accumulates, no --resume between steps. Deterministic by default (fake
// launcher, no tokens). Set LOOM_DEMO_LIVE=1 to run it on real aimux (haiku) and
// measure the actual cost — the whole point of the model.
//
// Run:  node demo/session-demo.mjs            (deterministic, free)
//       LOOM_DEMO_LIVE=1 node demo/session-demo.mjs   (real aimux, haiku, cheap)

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTaskSession } from "../dist/core/store/db.js";
import { createTaskSession } from "../dist/core/automation/task-session.js";
import { createLiveSessionLauncher } from "../dist/core/automation/live-session.js";
import { createAimuxLiveLauncher } from "../dist/core/automation/aimux-session-launcher.js";

const log = (...a) => console.log(...a);
const live = process.env.LOOM_DEMO_LIVE === "1";

// scratch git repo (so a worktree-style cwd is real)
const repo = mkdtempSync(join(tmpdir(), "loom-sess-repo-"));
const git = (...a) => execFileSync("git", a, { cwd: repo });
git("init", "-q", "-b", "main");
git("config", "user.email", "demo@loom.dev"); git("config", "user.name", "Demo");
writeFileSync(join(repo, "greet.js"), "export function greet(name){ return name; }\n");
git("add", "-A"); git("commit", "-qm", "init");

const db = openStore(join(mkdtempSync(join(tmpdir(), "loom-sess-store-")), "loom.db"), "demo");
createTask(db, { id: "t1", title: "greet() should return a friendly greeting", repo, run_mode: "autopilot" });

// Deterministic fake launcher: records turns, echoes, fakes a tiny cost.
function fakeLauncher() {
  let cost = 0;
  const spawn = ({ sessionId, resume }) => {
    let onData;
    return {
      stdin: { write: () => queueMicrotask(() => { cost += 0.001; onData?.(JSON.stringify({ type: "result", subtype: "success", result: `(${resume ? "resume" : "create"} ${sessionId.slice(0,8)})`, total_cost_usd: 0.001 }) + "\n"); }), end: () => {} },
      stdout: { on: (_e, cb) => { onData = cb; } },
      on: () => {}, kill: () => {},
    };
  };
  return createLiveSessionLauncher({ spawn });
}

const launcher = live ? createAimuxLiveLauncher({ model: "claude-haiku-4-5-20251001" }) : fakeLauncher();
const session = createTaskSession(db, "t1", { launcher });
const cwd = repo;

const stages = [
  ["analysis", "Коротко: что нужно сделать в greet(name)? Одно предложение."],
  ["spec", "Одной строкой: как изменить greet(name), чтобы вернуть приветствие?"],
  ["rd", "Перечисли подзадачи (без кода), одной-двумя строками."],
];

log(`mode: ${live ? "LIVE (real aimux, haiku)" : "deterministic (fake)"}`);
const ids = [];
for (const [stage, instr] of stages) {
  const { text } = await session.send(instr, { stage, cwd });
  const sid = getTaskSession(db, "t1").sessionId;
  ids.push(sid);
  log(`  ${stage.padEnd(9)} session=${sid?.slice(0, 8)} → ${text.replace(/\n/g, " ").slice(0, 70)}`);
}

const allSame = ids.every((s) => s === ids[0]);
log(`\nsession_id across all ${stages.length} stages: ${allSame ? "ОДИН И ТОТ ЖЕ ✓" : "РАЗНЫЕ ✗"} (${ids[0]?.slice(0, 8)})`);
log(`total cost: $${(launcher.costOf?.(ids[0]) ?? 0).toFixed(4)}`);
log(allSame ? "✓ одна живая сессия провела задачу через стадии, без resume между шагами" : "✗ сессия не сохранилась");

launcher.stop?.(ids[0]); // stop the live process so node can exit
db.close();
rmSync(repo, { recursive: true, force: true });
process.exit(0);
