import { homedir } from "node:os";
import { diagnoseAll } from "../core/doctor/doctor.js";
import { runMerge } from "../core/doctor/apply.js";
import { checkPrerequisites, type PrereqReport } from "../core/doctor/prereqs.js";
import type {
  DoctorReport,
  PluginContribution,
  ScopeDirs,
  ScopeName,
} from "../core/doctor/types.js";

export interface CliResult {
  code: number; // 0 ок / !=0 ошибка
  lines: string[]; // что напечатать
}

export interface ConfigCliDeps {
  dirs?: ScopeDirs;
  contributions?: PluginContribution[];
  checkPrereq?: () => PrereqReport;
}

const USAGE = [
  "Usage (использование): loom config <doctor|merge>",
  "  loom config doctor",
  "  loom config merge [--scope user|project|local] [--dry-run|--apply]",
];

const SCOPE_NAMES: ScopeName[] = ["user", "project", "local"];

function resolveDirs(deps: ConfigCliDeps): ScopeDirs {
  // В проде: домашняя директория + текущая рабочая. В тестах — инъекция.
  return deps.dirs ?? { homeDir: homedir(), projectDir: process.cwd() };
}

function resolveContributions(deps: ConfigCliDeps): PluginContribution[] {
  // По умолчанию пусто: формализация вклада плагинов из реестра/манифестов —
  // будущая задача. Пустой список => doctor покажет всё как missing, но не упадёт.
  return deps.contributions ?? [];
}

function formatDoctorScope(r: DoctorReport): string[] {
  const lines: string[] = [];
  lines.push(`${r.ok ? "✓" : "✗"} ${r.scope}`);
  if (r.missingMcp.length) lines.push(`    missing mcp: ${r.missingMcp.join(", ")}`);
  if (r.changedMcp.length) lines.push(`    changed mcp: ${r.changedMcp.join(", ")}`);
  if (r.missingHookEvents.length)
    lines.push(`    missing hooks: ${r.missingHookEvents.join(", ")}`);
  for (const c of r.mcpCollisions)
    lines.push(`    ⚠ коллизия mcp ${c.server}: ${c.plugins.join(", ")}`);
  for (const c of r.hookCollisions)
    lines.push(`    ⚠ коллизия hook ${c.event}: ${c.plugins.join(", ")}`);
  return lines;
}

function formatPrereqs(report: PrereqReport): string[] {
  const lines: string[] = ["", "Prerequisites:"];
  for (const t of report.tools) {
    const mark = t.found ? "✓" : "✗";
    lines.push(`  ${mark} ${t.name}${t.found ? "" : `  — ${t.hint}`}`);
  }
  return lines;
}

function doctorCmd(deps: ConfigCliDeps): CliResult {
  const dirs = resolveDirs(deps);
  const contributions = resolveContributions(deps);
  const reports = diagnoseAll(contributions, dirs);

  const lines: string[] = ["Config doctor:"];
  for (const r of reports) lines.push(...formatDoctorScope(r));

  const prereq = (deps.checkPrereq ?? checkPrerequisites)();
  lines.push(...formatPrereqs(prereq));

  return { code: 0, lines };
}

function parseMergeFlags(rest: string[]): { scope: ScopeName; apply: boolean } {
  let scope: ScopeName = "user";
  let apply = false; // dry-run по умолчанию
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a === "--scope") {
      const v = rest[i + 1];
      if (v && (SCOPE_NAMES as string[]).includes(v)) scope = v as ScopeName;
      i++;
    }
  }
  return { scope, apply };
}

function mergeCmd(rest: string[], deps: ConfigCliDeps): CliResult {
  const dirs = resolveDirs(deps);
  const contributions = resolveContributions(deps);
  const { scope, apply } = parseMergeFlags(rest);

  const result = runMerge({ scope, contributions, dirs, apply });

  const lines: string[] = [`Config merge (scope=${scope}, ${apply ? "apply" : "dry-run"}):`];
  if (result.diff.text) lines.push(result.diff.text);
  if (result.collisions.length)
    for (const c of result.collisions) lines.push(`⚠ коллизия: ${c}`);
  if (result.applied) {
    lines.push("Изменения применены (записано на диск).");
    if (result.backupPath) lines.push(`backup: ${result.backupPath}`);
  } else {
    lines.push("Dry-run: ничего не записано. Запусти с --apply, чтобы применить.");
  }
  return { code: 0, lines };
}

export function runConfigCli(args: string[], deps: ConfigCliDeps): CliResult {
  try {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
      case "doctor":
        return doctorCmd(deps);
      case "merge":
        return mergeCmd(rest, deps);
      default:
        return { code: 1, lines: [`Неизвестная подкоманда: ${sub ?? "(нет)"}`, ...USAGE] };
    }
  } catch (err) {
    return { code: 1, lines: [`Внутренняя ошибка CLI: ${(err as Error).message}`] };
  }
}
