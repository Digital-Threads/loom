import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loomRegistry } from "../plugins/index.js";
import { validateManifest } from "../plugins/manifest.js";
import { CATALOG_ENTRIES } from "./catalog-data.js";
import type { CatalogEntry, ResolvedEntry } from "./types.js";

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
