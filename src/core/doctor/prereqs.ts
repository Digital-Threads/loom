import type { CmdRunner } from "../install/types.js";
import { resolveProbeCmd } from "../install/recipe.js";
import { defaultRun } from "../install/runner.js";

export interface ToolStatus { name: string; found: boolean; hint: string; }
export interface PrereqReport { ok: boolean; tools: ToolStatus[]; missing: string[]; }

// Единый список пререк-инструментов экосистемы (LP2; LP5 doctor переиспользует — НЕ дублировать).
export const REQUIRED_TOOLS: { name: string; hint: string }[] = [
  { name: "node", hint: "Node.js required: https://nodejs.org" },
  { name: "npm", hint: "npm required (ships with Node.js): https://nodejs.org" },
  { name: "cargo", hint: "building from source: Rust ≥ 1.88 required (https://rustup.rs), takes a few minutes; the main path is a prebuilt binary" },
  { name: "claude", hint: "Claude Code CLI required: https://claude.com/claude-code" },
];

// Проверяет наличие инструментов через which/where (resolveProbeCmd). Инъекция run — для тестов.
export function checkPrerequisites(
  run: CmdRunner = defaultRun, platform: NodeJS.Platform = process.platform,
): PrereqReport {
  const probe = resolveProbeCmd("which", platform);
  const tools: ToolStatus[] = REQUIRED_TOOLS.map(({ name, hint }) => {
    const res = run(probe, [name]);
    return { name, found: res.ok, hint };
  });
  const missing = tools.filter((t) => !t.found).map((t) => t.name);
  return { ok: missing.length === 0, tools, missing };
}
