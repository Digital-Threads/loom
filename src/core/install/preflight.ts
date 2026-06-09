import type { InstallRecipe } from "../plugins/contract.js";
import { checkPrerequisites } from "../doctor/prereqs.js";

// step.cmd -> prerequisite tools. probe utilities (which/where/true) are NOT counted as prerequisites.
const CMD_TO_TOOLS: Record<string, string[]> = {
  npm: ["node", "npm"], npx: ["node", "npm"],
  cargo: ["cargo"], claude: ["claude"],
};

// Which tools the recipe needs: explicit requires or derived from the install steps. Pure.
export function requiredToolsForRecipe(recipe: InstallRecipe): string[] {
  if (recipe.requires && recipe.requires.length > 0) return [...recipe.requires];
  const set = new Set<string>();
  for (const step of recipe.install) {
    for (const t of CMD_TO_TOOLS[step.cmd] ?? []) set.add(t);
  }
  return [...set];
}

export interface PreflightResult { ok: boolean; missing: string[]; hint?: string; }
type CheckFn = (names: string[]) => { ok: boolean; missing: string[]; tools: { name: string; hint: string }[] };

// Checks that the tools the recipe needs are present. check is injected in tests; prod = filterPrereqs.
export function preflightRecipe(recipe: InstallRecipe, deps: { check?: CheckFn } = {}): PreflightResult {
  const need = requiredToolsForRecipe(recipe);
  if (need.length === 0) return { ok: true, missing: [] };
  const check = deps.check ?? filterPrereqs;
  const rep = check(need);
  if (rep.ok) return { ok: true, missing: [] };
  const hint = rep.tools.filter((t) => rep.missing.includes(t.name)).map((t) => t.hint).join("; ");
  return { ok: false, missing: rep.missing, hint };
}

// Prod wrapper: checkPrerequisites checks the whole REQUIRED_TOOLS, we filter by what the recipe needs.
function filterPrereqs(names: string[]) {
  const rep = checkPrerequisites();
  const tools = rep.tools.filter((t) => names.includes(t.name));
  const missing = tools.filter((t) => !t.found).map((t) => t.name);
  return { ok: missing.length === 0, missing, tools };
}
