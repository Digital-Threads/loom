import type { CmdRunner } from "../install/types.js";
import { resolveProbeCmd } from "../install/recipe.js";
import { defaultRun } from "../install/runner.js";

export interface ToolStatus { name: string; found: boolean; hint: string; }
export interface PrereqReport { ok: boolean; tools: ToolStatus[]; missing: string[]; }

// Единый список пререк-инструментов экосистемы (LP2; LP5 doctor переиспользует — НЕ дублировать).
export const REQUIRED_TOOLS: { name: string; hint: string }[] = [
  { name: "node", hint: "нужен Node.js: https://nodejs.org" },
  { name: "npm", hint: "нужен npm (идёт с Node.js): https://nodejs.org" },
  { name: "cargo", hint: "сборка из исходников: нужен Rust ≥ 1.88 (https://rustup.rs), займёт несколько минут; основной путь — готовый бинарник" },
  { name: "claude", hint: "нужен Claude Code CLI: https://claude.com/claude-code" },
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
