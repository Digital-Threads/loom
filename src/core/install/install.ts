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
import { preflightRecipe } from "./preflight.js";
import { runRecipe, synthesizeRecipeFromClaudePlugin } from "./recipe.js";
import type { RecipeCtx } from "./recipe.js";
import { readInstalled, writeInstalled } from "./registry-file.js";
import type {
  ClaudePluginRef,
  InstallDeps,
  InstallPlan,
  InstallResult,
  InstallSource,
} from "./types.js";

// ── Валидаторы входа (argument-injection hardening) ──────────────────────────
// Любой пользовательский source попадает в argv git/npm/tar/claude. Без проверки
// значение вида "-x" / "--upload-pack=evil" протащит флаг. Все валидаторы чистые
// и экспортируются для тестов.

// Значение «похоже на флаг»: начинается с "-" (после возможных пробелов) — отсекаем.
export function isFlagShaped(value: string): boolean {
  return /^\s*-/.test(value);
}

// git url: https?:// | git@host:path | github:owner/repo. Никаких флагов/пробелов в начале.
export function isValidGitUrl(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isFlagShaped(value)) return false;
  if (/^https?:\/\/\S+$/.test(value)) return true;
  if (/^git@[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$/.test(value)) return true;
  if (/^github:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)) return true;
  return false;
}

// npm package-spec: опц. scope + имя + опц. версия/диапазон. Не flag-shaped, без пробелов в начале.
export function isValidNpmSpec(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isFlagShaped(value)) return false;
  return /^(@[a-z0-9-._]+\/)?[a-z0-9-._]+(@[a-z0-9-._^~*x><=. |]+)?$/i.test(value);
}

// claude marketplace source: https?:// | owner/repo (github-форма) | ./локальный путь. Не flag-shaped.
export function isValidMarketplaceSource(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isFlagShaped(value)) return false;
  if (/^https?:\/\/\S+$/.test(value)) return true;
  if (/^\.{1,2}\//.test(value)) return true; // ./ или ../ локальный путь
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)) return true; // owner/repo
  return false;
}

// Имя найденного tgz: только безопасные символы и расширение .tgz, не flag-shaped.
export function isValidTgzName(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isFlagShaped(value)) return false;
  return /^[A-Za-z0-9._@/+-]+\.tgz$/.test(value);
}

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

// Defensive: из синтезированного claudePlugin-рецепта убираем шаг
// `claude plugin marketplace add -- <src>`, если source flag-shaped/невалидный
// (argument-injection hardening — раньше делала прошитая claude-ветка finalize).
function sanitizeSynthRecipe(
  recipe: import("@digital-threads/loom-contract").InstallRecipe,
): import("@digital-threads/loom-contract").InstallRecipe {
  const install = recipe.install.filter((step) => {
    const isMarketplaceAdd =
      step.cmd === "claude" &&
      step.args[0] === "plugin" &&
      step.args[1] === "marketplace" &&
      step.args[2] === "add";
    if (!isMarketplaceAdd) return true;
    const src = step.args[step.args.length - 1];
    return isValidMarketplaceSource(src);
  });
  return { ...recipe, install };
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
      if (!isValidNpmSpec(source.spec)) {
        return { ok: false, error: `invalid npm spec: ${source.spec}` };
      }
      const dest = mkdtempSync(join(tmpdir(), "loom-npm-"));
      // end-of-options "--" перед spec — spec не может быть распознан как флаг.
      const packed = deps.run("npm", ["pack", "--pack-destination", dest, "--", source.spec]);
      if (!packed.ok) return { ok: false, error: `npm pack failed: ${packed.stderr}` };
      // Имя tgz печатает npm pack на stdout (последняя строка). Если пусто — ищем в dest.
      let tgzName = packed.stdout.trim().split(/\r?\n/).pop() ?? "";
      let tgz = tgzName ? join(dest, tgzName) : "";
      if (!tgz || !existsSync(tgz)) {
        const found = existsSync(dest) ? readdirSync(dest).find((f) => f.endsWith(".tgz")) : undefined;
        tgzName = found ?? tgzName;
        tgz = found ? join(dest, found) : tgz;
      }
      // Имя tgz должно быть безопасным и не flag-shaped (defensive против подмены вывода).
      if (!isValidTgzName(tgzName)) {
        return { ok: false, error: `invalid tgz name: ${tgzName}` };
      }
      const out = mkdtempSync(join(tmpdir(), "loom-npm-x-"));
      // Защита от пути, начинающегося с "-": префиксуем "./". Затем "--" перед файлом.
      const safeTgz = tgz.startsWith("-") ? `./${tgz}` : tgz;
      const ex = deps.run("tar", ["-xzf", "-C", out, "--strip-components=1", "--", safeTgz]);
      if (!ex.ok) return { ok: false, error: `tar extract failed: ${ex.stderr}` };
      return { ok: true, dir: out };
    }

    // git
    if (!isValidGitUrl(source.url)) {
      return { ok: false, error: `invalid git url: ${source.url}` };
    }
    const dir = mkdtempSync(join(tmpdir(), "loom-git-"));
    // end-of-options "--" перед url — url не может быть распознан как флаг.
    const cloned = deps.run("git", ["clone", "--depth", "1", "--", source.url, dir]);
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

  const recipe = manifest.install
    ?? (manifest.claudePlugin
      ? sanitizeSynthRecipe(synthesizeRecipeFromClaudePlugin(normalizeClaudePlugin(manifest.claudePlugin)))
      : { install: [], detect: { probe: { cmd: "true", args: [] } }, remove: [] });

  const plan: InstallPlan = {
    name: manifest.name,
    version: manifest.version,
    manifest,
    installDir: join(deps.dataDir, "plugins", manifest.name, manifest.version),
    permissions: manifest.permissions ?? [],
    claudePlugin: manifest.claudePlugin
      ? normalizeClaudePlugin(manifest.claudePlugin)
      : undefined,
    recipe,
  };
  return { ok: true, plan };
}

// Выполняет установку ПОСЛЕ подтверждения: копирует файлы, пишет реестр, дергает claude CLI.
// Ошибки claude НЕ фейлят установку Loom-части — возвращаются как warning.
export function finalizeInstall(
  plan: InstallPlan,
  stagingDir: string,
  deps: InstallDeps,
  ctx: RecipeCtx = { scope: "user" },
): { ok: boolean; error?: string; warning?: string; missing?: string[] } {
  const pf = preflightRecipe(plan.recipe, { check: ctx.preflightCheck });
  if (!pf.ok) {
    return { ok: false, missing: pf.missing,
      error: `не хватает инструментов: ${pf.missing.join(", ")}${pf.hint ? ` — ${pf.hint}` : ""}` };
  }

  try {
    rmSync(plan.installDir, { recursive: true, force: true });
    mkdirSync(plan.installDir, { recursive: true });
    cpSync(stagingDir, plan.installDir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `copy failed: ${(err as Error).message}` };
  }

  // Рецепт гоняем ПОСЛЕ копирования, но ДО записи реестра: при провале
  // обязательного шага откатываем файлы и не оставляем запись в реестре.
  const rec = runRecipe(plan.recipe.install, ctx, deps);
  if (!rec.ok) {
    rmSync(plan.installDir, { recursive: true, force: true });
    return { ok: false, error: `install recipe failed: ${rec.error}` };
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

  return { ok: true, warning: rec.warning };
}

// Полный пайплайн: план → подтверждение → финализация.
export function installPlugin(
  source: InstallSource,
  deps: InstallDeps,
  onConfirm: (plan: InstallPlan) => boolean = () => true,
  ctx: RecipeCtx = { scope: "user" },
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

  const fin = finalizeInstall(planned.plan, staged.dir, deps, ctx);
  if (!fin.ok) return { ok: false, error: fin.error, missing: fin.missing, plan: planned.plan };
  return { ok: true, plan: planned.plan, warning: fin.warning };
}

// Удаляет плагин: убирает installDir, чистит реестр, пробует снять claude-плагин.
export function removePlugin(
  name: string,
  deps: InstallDeps,
  ctx: RecipeCtx = { scope: "user" },
): { ok: boolean; error?: string } {
  const reg = readInstalled(deps);
  const entry = reg.plugins[name];
  if (!entry) return { ok: false, error: `plugin not installed: ${name}` };

  // Собрать recipe из установленного plugin.json ДО удаления (defensive).
  let removeSteps: InstallPlan["recipe"]["remove"] = [];
  try {
    const raw = JSON.parse(readFileSync(join(entry.installPath, "plugin.json"), "utf8")) as unknown;
    const v = validateManifest(raw);
    if (v.ok) {
      const recipe = v.manifest.install
        ?? (v.manifest.claudePlugin
          ? synthesizeRecipeFromClaudePlugin(normalizeClaudePlugin(v.manifest.claudePlugin))
          : { install: [], detect: { probe: { cmd: "true", args: [] } }, remove: [] });
      removeSteps = recipe.remove;
    }
  } catch {
    // нет/битый манифест — пропускаем remove-рецепт
  }

  try {
    rmSync(entry.installPath, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: `remove failed: ${(err as Error).message}` };
  }

  delete reg.plugins[name];
  writeInstalled(deps, reg);

  // Defensive: провал remove-рецепта не блокирует чистку.
  runRecipe(removeSteps, ctx, deps);

  return { ok: true };
}
