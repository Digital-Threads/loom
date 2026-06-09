import { createRegistry } from "./registry.js";
import { plugin as aimux } from "./aimux/adapter.js";
import { plugin as tokenPilot } from "./token-pilot/adapter.js";
import { plugin as taskJournal } from "./task-journal/adapter.js";
import { discoverPlugins } from "./discover.js";
import { loadPlugins } from "./load.js";
import { loomPluginsDir } from "../paths.js";
import { readInstalled } from "../install/registry-file.js";
import { defaultDeps } from "../install/runner.js";

// Builtin seed -- synchronous. Consumers (App / loader / FormView) import
// loomRegistry synchronously, so the 3 built-in plugins must be present immediately.
export const loomRegistry = createRegistry([aimux, tokenPilot, taskJournal]);

// Asynchronously loads plugins from disk and registers them in loomRegistry.
// Builtin takes priority: a duplicate id -> we don't overwrite, we note it in errors.
// Does NOT throw -- returns the list of accumulated errors (may be empty).
export async function loadDynamicPlugins(
  dir: string = loomPluginsDir(),
): Promise<string[]> {
  const { found, errors } = discoverPlugins(dir);
  const { plugins, errors: loadErrors } = await loadPlugins(found);

  // We read the installed registry defensively: any failure -> filter is a no-op (load everything).
  let installed: ReturnType<typeof readInstalled>["plugins"] = {};
  try {
    installed = readInstalled(defaultDeps()).plugins;
  } catch {
    installed = {};
  }

  const dupErrors: string[] = [];
  for (const p of plugins) {
    // Skip only if the registry HAS an entry for this id AND it is enabled===false.
    // A plugin absent from plugins.json (built-in/bundled) -> load as-is.
    const entry = installed[p.id];
    if (entry && entry.enabled === false) continue;

    if (!loomRegistry.register(p)) {
      dupErrors.push(`duplicate id ${p.id} skipped`);
    }
  }

  return [...errors, ...loadErrors, ...dupErrors];
}
