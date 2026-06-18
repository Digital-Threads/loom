import type { CmdRunner } from "../install/types.js";
import { resolveProbeCmd } from "../install/recipe.js";
import { defaultRun } from "../install/runner.js";

// `optional` tools are not needed for the prebuilt-binary path (e.g. cargo, only
// for building from source). Consumers that gate the main path can skip them.
export interface ToolStatus { name: string; found: boolean; hint: string; optional?: boolean; }
export interface PrereqReport { ok: boolean; tools: ToolStatus[]; missing: string[]; }

// Single list of ecosystem prerequisite tools (LP2; the LP5 doctor reuses it -- do NOT duplicate).
export const REQUIRED_TOOLS: { name: string; hint: string; optional?: boolean }[] = [
  { name: "node", hint: "Node.js required: https://nodejs.org" },
  { name: "npm", hint: "npm required (ships with Node.js): https://nodejs.org" },
  { name: "cargo", hint: "building from source: Rust ≥ 1.88 required (https://rustup.rs), takes a few minutes; the main path is a prebuilt binary", optional: true },
  { name: "claude", hint: "Claude Code CLI required: https://claude.com/claude-code" },
];

// Checks for tools via which/where (resolveProbeCmd). The run injection is for tests.
export function checkPrerequisites(
  run: CmdRunner = defaultRun, platform: NodeJS.Platform = process.platform,
): PrereqReport {
  const probe = resolveProbeCmd("which", platform);
  const tools: ToolStatus[] = REQUIRED_TOOLS.map(({ name, hint, optional }) => {
    const res = run(probe, [name]);
    return { name, found: res.ok, hint, optional };
  });
  // Optional tools (e.g. cargo, only for building from source) never block the
  // main path — they stay in `tools` for visibility but are kept out of ok/missing.
  const missing = tools.filter((t) => !t.found && !t.optional).map((t) => t.name);
  return { ok: missing.length === 0, tools, missing };
}
