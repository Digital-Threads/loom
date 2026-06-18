#!/usr/bin/env node
// Standalone CLI: `loom-knowledge recall <query>` — prints prior decisions /
// rejections for the query from task-journal, in the current project.
import { recallPrior, partitionHits } from "./index.js";

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== "recall" || rest.length === 0) {
    console.log("usage: loom-knowledge recall <query>");
    process.exit(cmd ? 1 : 0);
  }
  const hits = recallPrior(process.cwd(), rest.join(" "));
  const { decisions, rejections } = partitionHits(hits);
  if (rejections.length) {
    console.log("Already rejected:");
    for (const h of rejections) console.log(`  - [${h.taskId}] ${h.text}`);
  }
  if (decisions.length) {
    console.log("Already decided:");
    for (const h of decisions) console.log(`  - [${h.taskId}] ${h.text}`);
  }
  if (!hits.length) console.log("(nothing prior found)");
}

main();
