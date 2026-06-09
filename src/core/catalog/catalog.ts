import { loomRegistry } from "../plugins/index.js";
import { validateManifest } from "../plugins/manifest.js";
import { CATALOG_ENTRIES } from "./catalog-data.js";
import type { CatalogEntry, ResolvedEntry, CatalogItem, CatalogStatus } from "./types.js";
import type { InstallDeps } from "../install/types.js";
import { detect, detectUpdate, compareVersions } from "../install/recipe.js";
import { readInstalled } from "../install/registry-file.js";
import aimuxManifest from "../plugins/aimux/plugin.json" with { type: "json" };
import tokenPilotManifest from "../plugins/token-pilot/plugin.json" with { type: "json" };
import taskJournalManifest from "../plugins/task-journal/plugin.json" with { type: "json" };

// Builtin plugin manifests live next to the adapters and are bundled into dist via
// JSON import (tsc inlines JSON into .js) -- no dependency on the FS at runtime.
const BUILTIN_MANIFESTS: Record<string, unknown> = {
  aimux: aimuxManifest,
  "token-pilot": tokenPilotManifest,
  "task-journal": taskJournalManifest,
};

function manifestRecipe(id: string) {
  const m = BUILTIN_MANIFESTS[id];
  if (!m) throw new Error(`no manifest for ${id}`);
  const v = validateManifest(m);
  if (!v.ok || !v.manifest.install) throw new Error(`no install recipe for ${id}`);
  return v.manifest.install;
}

export function resolveEntries(entries: CatalogEntry[] = CATALOG_ENTRIES): ResolvedEntry[] {
  return entries.map((e) => {
    const reg = loomRegistry.get(e.id);
    if (!reg?.category) throw new Error(`no category in registry for ${e.id}`);
    return { ...e, category: reg.category, recipe: manifestRecipe(e.id) };
  });
}

// fast path: installed + version (no latest/network). entries are injected in tests.
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

// Pure status upgrade based on the received latest (no network).
export function applyLatest(item: CatalogItem, latest?: string): CatalogItem {
  if (item.status === "not-installed" || !latest || !item.installedVersion) return item;
  const isNewer = compareVersions(latest, item.installedVersion) > 0;
  return isNewer
    ? { ...item, status: "update-available", latestVersion: latest }
    : { ...item, latestVersion: latest };
}

// Network detection of the latest version (LP2). Isolated so the fast path does NOT call it.
export function detectLatest(item: CatalogItem, deps: InstallDeps): string | undefined {
  return detectUpdate(item.recipe.detect, deps).latest;
}
