import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loomRegistry } from "../plugins/index.js";
import { validateManifest } from "../plugins/manifest.js";
import { CATALOG_ENTRIES } from "./catalog-data.js";
import type { CatalogEntry, ResolvedEntry, CatalogItem, CatalogStatus } from "./types.js";
import type { InstallDeps } from "../install/types.js";
import { detect, detectUpdate, compareVersions } from "../install/recipe.js";
import { readInstalled } from "../install/registry-file.js";

// ESM-safe аналог __dirname: проект — "type":"module" (module: ESNext),
// хост запускается как `node dist/cli.js`, где __dirname не определён.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKGS = join(__dirname, "../../../packages");

function manifestRecipe(id: string) {
  const m = JSON.parse(readFileSync(join(PKGS, `loom-plugin-${id}`, "plugin.json"), "utf8"));
  const v = validateManifest(m);
  if (!v.ok || !v.manifest.install) throw new Error(`нет install-рецепта у ${id}`);
  return v.manifest.install;
}

export function resolveEntries(entries: CatalogEntry[] = CATALOG_ENTRIES): ResolvedEntry[] {
  return entries.map((e) => {
    const reg = loomRegistry.get(e.id);
    if (!reg?.category) throw new Error(`нет category в реестре у ${e.id}`);
    return { ...e, category: reg.category, recipe: manifestRecipe(e.id) };
  });
}

// fast-путь: installed + version (без latest/сети). entries инъектируются в тестах.
export function buildCatalog(
  deps: InstallDeps,
  entries: ResolvedEntry[] = resolveEntries(),
): CatalogItem[] {
  const reg = readInstalled(deps).plugins;
  return entries.map((e) => {
    const det = detect(e.recipe.detect, deps);
    const regEntry = reg[e.id];
    const status: CatalogStatus = det.installed || regEntry ? "installed" : "not-installed";
    return {
      ...e,
      status,
      installedVersion: det.version ?? regEntry?.version,
      enabled: regEntry?.enabled,
    };
  });
}

// Чистый апгрейд статуса по полученному latest (без сети).
export function applyLatest(item: CatalogItem, latest?: string): CatalogItem {
  if (item.status === "not-installed" || !latest || !item.installedVersion) return item;
  const isNewer = compareVersions(latest, item.installedVersion) > 0;
  return isNewer
    ? { ...item, status: "update-available", latestVersion: latest }
    : { ...item, latestVersion: latest };
}

// Сетевой детект последней версии (LP2). Изолирован, чтобы fast-путь его НЕ звал.
export function detectLatest(item: CatalogItem, deps: InstallDeps): string | undefined {
  return detectUpdate(item.recipe.detect, deps).latest;
}
