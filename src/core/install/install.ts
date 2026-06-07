// Ядро пайплайна установки/удаления Loom-плагинов (Task 10.2).
// Все функции defensive (НЕ бросают). Внешние эффекты идут через deps.run и deps.dataDir.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest } from "../plugins/manifest.js";
import { readInstalled, writeInstalled } from "./registry-file.js";
import type {
  ClaudePluginRef,
  InstallDeps,
  InstallPlan,
  InstallResult,
  InstallSource,
} from "./types.js";

// Человекочитаемое описание источника для записи в реестр.
function describeSource(source: InstallSource): string {
  switch (source.type) {
    case "local":
      return `local:${source.path}`;
    case "npm":
      return `npm:${source.spec}`;
    case "git":
      return `git:${source.url}`;
  }
}

// Приводим claudePlugin.source (string | {source:"github";repo} | undefined) к строке.
function normalizeClaudePlugin(
  cp: NonNullable<import("@digital-threads/loom-contract").LoomPluginManifest["claudePlugin"]>,
): ClaudePluginRef {
  let source: string | undefined;
  if (typeof cp.source === "string") {
    source = cp.source;
  } else if (cp.source && typeof cp.source === "object" && cp.source.source === "github") {
    source = cp.source.repo;
  }
  return { name: cp.name, marketplace: cp.marketplace, source };
}

// Кладёт сырьё плагина в каталог, возвращает путь к корню (где plugin.json).
// npm/git реально качают через deps.run; в тестах run фейковый — эффектов нет.
export function fetchToStaging(
  source: InstallSource,
  deps: InstallDeps,
): { ok: boolean; dir?: string; error?: string } {
  try {
    if (source.type === "local") {
      if (!existsSync(join(source.path, "plugin.json"))) {
        return { ok: false, error: `plugin.json not found in ${source.path}` };
      }
      // Не копируем на этом шаге — копия при финализации.
      return { ok: true, dir: source.path };
    }

    if (source.type === "npm") {
      const dest = mkdtempSync(join(tmpdir(), "loom-npm-"));
      const packed = deps.run("npm", ["pack", source.spec, "--pack-destination", dest]);
      if (!packed.ok) return { ok: false, error: `npm pack failed: ${packed.stderr}` };
      // Имя tgz печатает npm pack на stdout (последняя строка). Если пусто — ищем в dest.
      let tgz = packed.stdout.trim().split(/\r?\n/).pop() ?? "";
      if (tgz) tgz = join(dest, tgz);
      if (!tgz || !existsSync(tgz)) {
        const found = existsSync(dest) ? readdirSync(dest).find((f) => f.endsWith(".tgz")) : undefined;
        tgz = found ? join(dest, found) : tgz;
      }
      const out = mkdtempSync(join(tmpdir(), "loom-npm-x-"));
      const ex = deps.run("tar", ["-xzf", tgz, "-C", out, "--strip-components=1"]);
      if (!ex.ok) return { ok: false, error: `tar extract failed: ${ex.stderr}` };
      return { ok: true, dir: out };
    }

    // git
    const dir = mkdtempSync(join(tmpdir(), "loom-git-"));
    const cloned = deps.run("git", ["clone", "--depth", "1", source.url, dir]);
    if (!cloned.ok) return { ok: false, error: `git clone failed: ${cloned.stderr}` };
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? String(err) };
  }
}

// Строит план установки: fetch → читает plugin.json → validateManifest → InstallPlan.
export function planInstall(source: InstallSource, deps: InstallDeps): InstallResult {
  const staged = fetchToStaging(source, deps);
  if (!staged.ok || !staged.dir) {
    return { ok: false, error: staged.error ?? "fetch failed" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(staged.dir, "plugin.json"), "utf8"));
  } catch (err) {
    return { ok: false, error: `cannot read plugin.json: ${(err as Error).message}` };
  }

  const v = validateManifest(raw);
  if (!v.ok) return { ok: false, error: v.error };
  const manifest = v.manifest;

  const plan: InstallPlan = {
    name: manifest.name,
    version: manifest.version,
    manifest,
    installDir: join(deps.dataDir, "plugins", manifest.name, manifest.version),
    permissions: manifest.permissions ?? [],
    claudePlugin: manifest.claudePlugin
      ? normalizeClaudePlugin(manifest.claudePlugin)
      : undefined,
  };
  return { ok: true, plan };
}

// Выполняет установку ПОСЛЕ подтверждения: копирует файлы, пишет реестр, дергает claude CLI.
// Ошибки claude НЕ фейлят установку Loom-части — возвращаются как warning.
export function finalizeInstall(
  plan: InstallPlan,
  stagingDir: string,
  deps: InstallDeps,
): { ok: boolean; error?: string; warning?: string } {
  try {
    rmSync(plan.installDir, { recursive: true, force: true });
    mkdirSync(plan.installDir, { recursive: true });
    cpSync(stagingDir, plan.installDir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `copy failed: ${(err as Error).message}` };
  }

  const reg = readInstalled(deps);
  reg.plugins[plan.name] = {
    version: plan.version,
    installPath: plan.installDir,
    enabled: true,
    source: describeSource({ type: "local", path: stagingDir }),
    installedAt: new Date().toISOString(),
  };
  writeInstalled(deps, reg);

  let warning: string | undefined;
  if (plan.claudePlugin) {
    const cp = plan.claudePlugin;
    if (cp.source) {
      const added = deps.run("claude", ["plugin", "marketplace", "add", cp.source]);
      if (!added.ok) warning = `claude marketplace add: ${added.stderr}`;
    }
    const installed = deps.run("claude", [
      "plugin",
      "install",
      `${cp.name}@${cp.marketplace}`,
      "--scope",
      "user",
    ]);
    if (!installed.ok) {
      warning = warning
        ? `${warning}; claude install: ${installed.stderr}`
        : `claude install: ${installed.stderr}`;
    }
  }

  return { ok: true, warning };
}

// Полный пайплайн: план → подтверждение → финализация.
export function installPlugin(
  source: InstallSource,
  deps: InstallDeps,
  onConfirm: (plan: InstallPlan) => boolean = () => true,
): InstallResult {
  const planned = planInstall(source, deps);
  if (!planned.ok || !planned.plan) return planned;

  if (!onConfirm(planned.plan)) {
    return { ok: false, error: "отменено", plan: planned.plan };
  }

  // Для local исходник = source.path; для npm/git staging уже скачан в fetchToStaging,
  // но planInstall не возвращает staging-каталог наружу → перезапрашиваем для финализации.
  const staged = source.type === "local" ? { ok: true, dir: source.path } : fetchToStaging(source, deps);
  if (!staged.ok || !staged.dir) {
    return { ok: false, error: staged.error ?? "fetch failed", plan: planned.plan };
  }

  const fin = finalizeInstall(planned.plan, staged.dir, deps);
  if (!fin.ok) return { ok: false, error: fin.error, plan: planned.plan };
  return { ok: true, plan: planned.plan, warning: fin.warning };
}

// Удаляет плагин: убирает installDir, чистит реестр, пробует снять claude-плагин.
export function removePlugin(name: string, deps: InstallDeps): { ok: boolean; error?: string } {
  const reg = readInstalled(deps);
  const entry = reg.plugins[name];
  if (!entry) return { ok: false, error: `plugin not installed: ${name}` };

  // Прочитать claudePlugin из установленного plugin.json ДО удаления (defensive).
  let cp: ClaudePluginRef | undefined;
  try {
    const raw = JSON.parse(readFileSync(join(entry.installPath, "plugin.json"), "utf8")) as unknown;
    const v = validateManifest(raw);
    if (v.ok && v.manifest.claudePlugin) cp = normalizeClaudePlugin(v.manifest.claudePlugin);
  } catch {
    // нет/битый манифест — пропускаем claude-uninstall
  }

  try {
    rmSync(entry.installPath, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: `remove failed: ${(err as Error).message}` };
  }

  delete reg.plugins[name];
  writeInstalled(deps, reg);

  if (cp) {
    deps.run("claude", ["plugin", "uninstall", `${cp.name}@${cp.marketplace}`]);
  }

  return { ok: true };
}
