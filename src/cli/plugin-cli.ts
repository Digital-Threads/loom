// Тестируемое ядро CLI `loom plugin <add|remove|list>` (Task 10.3).
// Чистая логика без process.exit/argv/console внутри — всё через CliResult.
// I/O ограничен пайплайном установки (deps) + existsSync для эвристики local.
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { installPlugin, planInstall, removePlugin } from "../core/install/install.js";
import { readInstalled } from "../core/install/registry-file.js";
import type { InstallDeps, InstallSource } from "../core/install/types.js";

export interface CliResult {
  code: number; // 0 ок / !=0 ошибка
  lines: string[]; // что напечатать
}

const USAGE = [
  "Использование: loom plugin <add|remove|list>",
  "  loom plugin list",
  "  loom plugin add <source> [--yes]",
  "  loom plugin remove <name>",
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

function addCmd(rest: string[], deps: InstallDeps): CliResult {
  const yes = rest.includes("--yes");
  const sourceArg = rest.find((a) => a !== "--yes");
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

  const res = installPlugin(source, deps, () => true);
  if (!res.ok) {
    return { code: 1, lines: [...lines, `Ошибка установки: ${res.error ?? "неизвестно"}`] };
  }
  lines.push(`✓ установлен ${plan.name}@${plan.version}`);
  if (res.warning) lines.push(`⚠ ${res.warning}`);
  return { code: 0, lines };
}

function removeCmd(rest: string[], deps: InstallDeps): CliResult {
  const name = rest[0];
  if (!name) {
    return { code: 1, lines: ["loom plugin remove: укажите имя", ...USAGE] };
  }
  const res = removePlugin(name, deps);
  if (!res.ok) {
    return { code: 1, lines: [`Ошибка: ${res.error ?? "не удалось удалить"}`] };
  }
  return { code: 0, lines: [`✓ удалён ${name}`] };
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
      default:
        return { code: 1, lines: [`Неизвестная подкоманда: ${sub ?? "(нет)"}`, ...USAGE] };
    }
  } catch (err) {
    return { code: 1, lines: [`Внутренняя ошибка CLI: ${(err as Error).message}`] };
  }
}
