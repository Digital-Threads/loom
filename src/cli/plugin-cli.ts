// Testable core of the CLI `loom plugin <add|remove|list>` (Task 10.3).
// Pure logic with no process.exit/argv/console inside -- everything via CliResult.
// I/O is limited to the install pipeline (deps) + existsSync for the local heuristic.
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installPlugin, planInstall, removePlugin } from "../core/install/install.js";
import { detectUpdate, isValidScope, type RecipeCtx } from "../core/install/recipe.js";
import { readInstalled } from "../core/install/registry-file.js";
import type { InstallDeps, InstallSource } from "../core/install/types.js";

export interface CliResult {
  code: number; // 0 ok / !=0 error
  lines: string[]; // what to print
}

const USAGE = [
  "Usage: loom plugin <add|remove|list|detect>",
  "  loom plugin list",
  "  loom plugin add <source> [--yes] [--scope user|project]",
  "  loom plugin remove <name> [--scope user|project]",
  "  loom plugin detect <name>",
];

// Whether it looks like an existing path to a local folder.
function isExistingDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Source heuristic. Pure, except existsSync for local.
export function parseSource(arg: string): InstallSource {
  // git: github:owner/repo, http(s)://...git, *.git, git@...
  if (
    arg.startsWith("github:") ||
    arg.startsWith("git@") ||
    arg.endsWith(".git") ||
    (/^https?:\/\//.test(arg) && (arg.includes(".git") || arg.includes("git")))
  ) {
    return { type: "git", url: arg };
  }
  // local: starts with "." or "/", an absolute path, or an existing folder.
  if (arg.startsWith(".") || arg.startsWith("/") || isAbsolute(arg) || isExistingDir(arg)) {
    return { type: "local", path: arg };
  }
  // otherwise an npm spec.
  return { type: "npm", spec: arg };
}

function listCmd(deps: InstallDeps): CliResult {
  const reg = readInstalled(deps);
  const names = Object.keys(reg.plugins);
  if (names.length === 0) {
    return { code: 0, lines: ["no installed plugins"] };
  }
  const lines = names.map((name) => {
    const e = reg.plugins[name];
    const enabled = e.enabled ? "enabled" : "disabled";
    return `${name}  ${e.version}  ${enabled}  ${e.installPath}`;
  });
  return { code: 0, lines };
}

// Extracts the value of the "--scope <v>" flag from the arguments. Defensive:
// no flag -> undefined; flag without a value -> undefined; otherwise the value string.
function parseScopeFlag(rest: string[]): { scope: string | undefined; positional: string[] } {
  const positional: string[] = [];
  let scope: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--scope") {
      scope = rest[i + 1];
      i++;
      continue;
    }
    if (a === "--yes") continue;
    positional.push(a);
  }
  return { scope, positional };
}

function addCmd(rest: string[], deps: InstallDeps): CliResult {
  const yes = rest.includes("--yes");
  const { scope: scopeArg, positional } = parseScopeFlag(rest);
  const scope = scopeArg ?? "user";
  if (!isValidScope(scope)) {
    return { code: 1, lines: [`Error: invalid scope: ${scope} (expected user|project)`] };
  }
  const sourceArg = positional[0];
  if (!sourceArg) {
    return { code: 1, lines: ["loom plugin add: specify a source", ...USAGE] };
  }

  const source = parseSource(sourceArg);
  const planned = planInstall(source, deps);
  if (!planned.ok || !planned.plan) {
    return { code: 1, lines: [`Error: ${planned.error ?? "failed to build plan"}`] };
  }
  const plan = planned.plan;

  const lines: string[] = [`${plan.name}@${plan.version}`];
  lines.push("Permissions:");
  if (plan.permissions.length === 0) {
    lines.push("  none");
  } else {
    for (const p of plan.permissions) lines.push(`  ${p}`);
  }
  if (plan.claudePlugin) {
    const cp = plan.claudePlugin;
    lines.push(`claude plugin: ${cp.name}@${cp.marketplace}${cp.source ? ` (${cp.source})` : ""}`);
  }

  if (!yes) {
    const actions = plan.claudePlugin
      ? "will run: copy + register + claude install"
      : "will run: copy + register";
    lines.push(`Add --yes to install (${actions})`);
    return { code: 0, lines };
  }

  const ctx: RecipeCtx = { scope };
  const res = installPlugin(source, deps, () => true, ctx);
  if (!res.ok) {
    return { code: 1, lines: [...lines, `Install error: ${res.error ?? "unknown"}`] };
  }
  lines.push(`✓ installed ${plan.name}@${plan.version}`);
  if (res.warning) lines.push(`⚠ ${res.warning}`);
  if (res.manual?.length) {
    lines.push("Next, run manually:");
    for (const cmd of res.manual) lines.push(`  ${cmd.join(" ")}`);
  }
  return { code: 0, lines };
}

function removeCmd(rest: string[], deps: InstallDeps): CliResult {
  const { scope: scopeArg, positional } = parseScopeFlag(rest);
  const scope = scopeArg ?? "user";
  if (!isValidScope(scope)) {
    return { code: 1, lines: [`Error: invalid scope: ${scope} (expected user|project)`] };
  }
  const name = positional[0];
  if (!name) {
    return { code: 1, lines: ["loom plugin remove: specify a name", ...USAGE] };
  }
  const ctx: RecipeCtx = { scope };
  const res = removePlugin(name, deps, ctx);
  if (!res.ok) {
    return { code: 1, lines: [`Error: ${res.error ?? "failed to remove"}`] };
  }
  return { code: 0, lines: [`✓ removed ${name}`] };
}

// detect <name>: finds the plugin in the registry, reads its plugin.json, runs the detect probe.
// Defensive: not in the registry -> code 1; corrupt/missing manifest -> no detect -> "not installed".
function detectCmd(rest: string[], deps: InstallDeps): CliResult {
  const name = rest[0];
  if (!name) {
    return { code: 1, lines: ["loom plugin detect: specify a name", ...USAGE] };
  }
  const reg = readInstalled(deps);
  const entry = reg.plugins[name];
  if (!entry) {
    return { code: 1, lines: [`Error: plugin not installed: ${name}`] };
  }

  let detectSpec:
    | {
        probe: { cmd: string; args: string[] };
        presenceMatch?: string;
        versionRegex?: string;
        latest?: { probe: { cmd: string; args: string[] }; versionRegex?: string };
      }
    | undefined;
  try {
    const raw = JSON.parse(readFileSync(join(entry.installPath, "plugin.json"), "utf8")) as {
      install?: { detect?: typeof detectSpec };
    };
    detectSpec = raw.install?.detect;
  } catch {
    // missing/corrupt manifest -> detectSpec stays undefined
  }

  if (!detectSpec) {
    return { code: 0, lines: [`not installed ${name}`] };
  }

  const result = detectUpdate(detectSpec, deps);
  if (!result.installed) {
    return { code: 0, lines: [`not installed ${name}`] };
  }
  const ver = result.version ? ` (version ${result.version})` : "";
  const upd =
    result.updateAvailable === true ? ` ↻ available ${result.latest ?? ""}`.trimEnd() : "";
  return { code: 0, lines: [`installed ${name}${ver}${upd}`] };
}

// args = everything after "loom plugin": ["add","./x","--yes"] / ["list"] / ["remove","name"].
// Defensive: throws nothing, any failure -> a CliResult with code!=0.
export function runPluginCli(args: string[], deps: InstallDeps): CliResult {
  try {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
      case "list":
        return listCmd(deps);
      case "add":
        return addCmd(rest, deps);
      case "remove":
        return removeCmd(rest, deps);
      case "detect":
        return detectCmd(rest, deps);
      default:
        return { code: 1, lines: [`Unknown subcommand: ${sub ?? "(none)"}`, ...USAGE] };
    }
  } catch (err) {
    return { code: 1, lines: [`Internal CLI error: ${(err as Error).message}`] };
  }
}
