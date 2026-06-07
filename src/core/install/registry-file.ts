// Чтение/запись реестра установленных плагинов: <dataDir>/plugins.json.
// Defensive: нет файла/битый JSON → пустой реестр.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InstallDeps, InstalledRegistry } from "./types.js";

function registryPath(deps: InstallDeps): string {
  return join(deps.dataDir, "plugins.json");
}

function empty(): InstalledRegistry {
  return { schemaVersion: 1, plugins: {} };
}

export function readInstalled(deps: InstallDeps): InstalledRegistry {
  const file = registryPath(deps);
  if (!existsSync(file)) return empty();
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return empty();
    const r = raw as Partial<InstalledRegistry>;
    const plugins = r.plugins;
    if (typeof plugins !== "object" || plugins === null || Array.isArray(plugins)) {
      return empty();
    }
    return { schemaVersion: 1, plugins: plugins as InstalledRegistry["plugins"] };
  } catch {
    return empty();
  }
}

export function writeInstalled(deps: InstallDeps, reg: InstalledRegistry): void {
  mkdirSync(deps.dataDir, { recursive: true });
  writeFileSync(registryPath(deps), JSON.stringify(reg, null, 2), "utf8");
}

// Переключает флаг enabled установленного плагина. Defensive:
// нет такого name → {ok:false}; иначе пишет реестр и {ok:true}.
export function setEnabled(
  deps: InstallDeps,
  name: string,
  enabled: boolean,
): { ok: boolean; error?: string } {
  const reg = readInstalled(deps);
  const entry = reg.plugins[name];
  if (!entry) return { ok: false, error: `plugin not installed: ${name}` };
  entry.enabled = enabled;
  writeInstalled(deps, reg);
  return { ok: true };
}
