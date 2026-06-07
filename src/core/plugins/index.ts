import { createRegistry } from "./registry.js";
import { plugin as aimux } from "@digital-threads/loom-plugin-aimux";
import { plugin as tokenPilot } from "@digital-threads/loom-plugin-token-pilot";
import { plugin as taskJournal } from "@digital-threads/loom-plugin-task-journal";
import { discoverPlugins } from "./discover.js";
import { loadPlugins } from "./load.js";
import { loomPluginsDir } from "../paths.js";

// Builtin-сид — синхронно. Потребители (App / loader / FormView) импортят
// loomRegistry синхронно, поэтому 3 встроенных плагина должны быть на месте сразу.
export const loomRegistry = createRegistry([aimux, tokenPilot, taskJournal]);

// Асинхронно подгружает плагины с диска и регистрирует в loomRegistry.
// Builtin приоритетнее: дубль id → не перезаписываем, помечаем в ошибках.
// НЕ бросает — возвращает список накопленных ошибок (может быть пустым).
export async function loadDynamicPlugins(
  dir: string = loomPluginsDir(),
): Promise<string[]> {
  const { found, errors } = discoverPlugins(dir);
  const { plugins, errors: loadErrors } = await loadPlugins(found);

  const dupErrors: string[] = [];
  for (const p of plugins) {
    if (!loomRegistry.register(p)) {
      dupErrors.push(`дубль id ${p.id} пропущен`);
    }
  }

  return [...errors, ...loadErrors, ...dupErrors];
}
