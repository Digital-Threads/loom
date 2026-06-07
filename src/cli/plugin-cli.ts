// Тестируемое ядро CLI `loom plugin <add|remove|list>` (Task 10.3).
// Чистая логика без process.exit/argv/console внутри — всё через CliResult.
// I/O ограничен пайплайном установки (deps) + existsSync для эвристики local.
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installPlugin, planInstall, removePlugin } from "../core/install/install.js";
import { detect, isValidScope, type RecipeCtx } from "../core/install/recipe.js";
import { readInstalled } from "../core/install/registry-file.js";
import type { InstallDeps, InstallSource } from "../core/install/types.js";

export interface CliResult {
  code: number; // 0 ок / !=0 ошибка
  lines: string[]; // что напечатать
}

const USAGE = [
  "Использование: loom plugin <add|remove|list|detect>",
  "  loom plugin list",
  "  loom plugin add <source> [--yes] [--scope user|project]",
  "  loom plugin remove <name> [--scope user|project]",
  "  loom plugin detect <name>",
];

// Похоже ли на существующий путь к локальной папке.
function isExistingDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Эвристика источника. Чистая, кроме existsSync для local.
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
  // local: начинается с "." или "/", абсолютный путь, или существующая папка.
  if (arg.startsWith(".") || arg.startsWith("/") || isAbsolute(arg) || isExistingDir(arg)) {
    return { type: "local", path: arg };
  }
  // иначе npm-спека.
  return { type: "npm", spec: arg };
}

function listCmd(deps: InstallDeps): CliResult {
  const reg = readInstalled(deps);
  const names = Object.keys(reg.plugins);
  if (names.length === 0) {
    return { code: 0, lines: ["нет установленных плагинов"] };
  }
  const lines = names.map((name) => {
    const e = reg.plugins[name];
    const enabled = e.enabled ? "enabled" : "disabled";
    return `${name}  ${e.version}  ${enabled}  ${e.installPath}`;
  });
  return { code: 0, lines };
}

// Извлекает значение флага "--scope <v>" из аргументов. Defensive:
// нет флага → undefined; флаг без значения → undefined; иначе строка значения.
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
    return { code: 1, lines: [`Ошибка: невалидный scope: ${scope} (ожидается user|project)`] };
  }
  const sourceArg = positional[0];
  if (!sourceArg) {
    return { code: 1, lines: ["loom plugin add: укажите источник", ...USAGE] };
  }

  const source = parseSource(sourceArg);
  const planned = planInstall(source, deps);
  if (!planned.ok || !planned.plan) {
    return { code: 1, lines: [`Ошибка: ${planned.error ?? "не удалось построить план"}`] };
  }
  const plan = planned.plan;

  const lines: string[] = [`${plan.name}@${plan.version}`];
  lines.push("Разрешения:");
  if (plan.permissions.length === 0) {
    lines.push("  нет");
  } else {
    for (const p of plan.permissions) lines.push(`  ${p}`);
  }
  if (plan.claudePlugin) {
    const cp = plan.claudePlugin;
    lines.push(`claude-плагин: ${cp.name}@${cp.marketplace}${cp.source ? ` (${cp.source})` : ""}`);
  }

  if (!yes) {
    const actions = plan.claudePlugin
      ? "будут выполнены: копирование + регистрация + claude install"
      : "будут выполнены: копирование + регистрация";
    lines.push(`Для установки добавьте --yes (${actions})`);
    return { code: 0, lines };
  }

  const ctx: RecipeCtx = { scope };
  const res = installPlugin(source, deps, () => true, ctx);
  if (!res.ok) {
    return { code: 1, lines: [...lines, `Ошибка установки: ${res.error ?? "неизвестно"}`] };
  }
  lines.push(`✓ установлен ${plan.name}@${plan.version}`);
  if (res.warning) lines.push(`⚠ ${res.warning}`);
  return { code: 0, lines };
}

function removeCmd(rest: string[], deps: InstallDeps): CliResult {
  const { scope: scopeArg, positional } = parseScopeFlag(rest);
  const scope = scopeArg ?? "user";
  if (!isValidScope(scope)) {
    return { code: 1, lines: [`Ошибка: невалидный scope: ${scope} (ожидается user|project)`] };
  }
  const name = positional[0];
  if (!name) {
    return { code: 1, lines: ["loom plugin remove: укажите имя", ...USAGE] };
  }
  const ctx: RecipeCtx = { scope };
  const res = removePlugin(name, deps, ctx);
  if (!res.ok) {
    return { code: 1, lines: [`Ошибка: ${res.error ?? "не удалось удалить"}`] };
  }
  return { code: 0, lines: [`✓ удалён ${name}`] };
}

// detect <name>: ищет плагин в реестре, читает его plugin.json, прогоняет detect-пробу.
// Defensive: нет в реестре → code 1; битый/нет манифеста → нет detect → "не установлен".
function detectCmd(rest: string[], deps: InstallDeps): CliResult {
  const name = rest[0];
  if (!name) {
    return { code: 1, lines: ["loom plugin detect: укажите имя", ...USAGE] };
  }
  const reg = readInstalled(deps);
  const entry = reg.plugins[name];
  if (!entry) {
    return { code: 1, lines: [`Ошибка: плагин не установлен: ${name}`] };
  }

  let detectSpec: { probe: { cmd: string; args: string[] }; presenceMatch?: string; versionRegex?: string } | undefined;
  try {
    const raw = JSON.parse(readFileSync(join(entry.installPath, "plugin.json"), "utf8")) as {
      install?: { detect?: typeof detectSpec };
    };
    detectSpec = raw.install?.detect;
  } catch {
    // нет/битый манифест → detectSpec остаётся undefined
  }

  if (!detectSpec) {
    return { code: 0, lines: [`не установлен ${name}`] };
  }

  const result = detect(detectSpec, deps);
  if (!result.installed) {
    return { code: 0, lines: [`не установлен ${name}`] };
  }
  const ver = result.version ? ` (версия ${result.version})` : "";
  return { code: 0, lines: [`установлен ${name}${ver}`] };
}

// args = всё после "loom plugin": ["add","./x","--yes"] / ["list"] / ["remove","name"].
// Defensive: ничего не бросает, любой сбой → CliResult с code!=0.
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
        return { code: 1, lines: [`Неизвестная подкоманда: ${sub ?? "(нет)"}`, ...USAGE] };
    }
  } catch (err) {
    return { code: 1, lines: [`Внутренняя ошибка CLI: ${(err as Error).message}`] };
  }
}
