// Bun-native smoke: the core store + pipeline run on bun:sqlite under Bun.
// Run: bun test/bun-smoke.mjs  (must be Bun, not Node).
import { openStore, createTask, getStages } from "../dist/core/store/db.js";
import { boardColumns, startTask } from "../dist/core/pipeline/engine.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (typeof Bun === "undefined") { console.error("FAIL: not running under Bun"); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), "loom-bun-"));
const db = openStore(join(dir, "t.db")); // exercises bun:sqlite driver path
createTask(db, { id: "b1", title: "Bun task" });
startTask(db, "b1");
const stages = getStages(db, "b1");
const cols = boardColumns(db);
const analysis = cols.find((c) => c.stageKey === "analysis");
const ok = stages.length === 9 && analysis?.cards.some((c) => c.id === "b1");
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(ok ? "PASS: bun:sqlite store + pipeline OK under Bun" : "FAIL");
process.exit(ok ? 0 : 1);
