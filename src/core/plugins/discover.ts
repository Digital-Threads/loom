import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest, type LoomPluginManifest } from "./manifest.js";

export interface DiscoveredManifest {
  manifest: LoomPluginManifest;
  installDir: string; // каталог где лежит plugin.json (<name>/<version>)
  manifestPath: string;
}

// Скан <pluginsDir>/<name>/<version>/plugin.json. Defensive:
//  - несуществующий каталог → {found:[], errors:[]} (НЕ бросать)
//  - битый JSON / невалидный манифест → запись в errors, skip
//  - одна битая папка не валит весь скан
// Дубли name тут НЕ разрешаются (это 8.3 при сборке реестра) — возвращаем всё.
export function discoverPlugins(pluginsDir: string): {
  found: DiscoveredManifest[];
  errors: string[];
} {
  const found: DiscoveredManifest[] = [];
  const errors: string[] = [];

  const nameDirs = safeReaddir(pluginsDir);
  for (const name of nameDirs) {
    const nameDir = join(pluginsDir, name);
    const versionDirs = safeReaddir(nameDir);
    for (const version of versionDirs) {
      const installDir = join(nameDir, version);
      const manifestPath = join(installDir, "plugin.json");

      let text: string;
      try {
        text = readFileSync(manifestPath, "utf8");
      } catch {
        // нет plugin.json в этом каталоге — просто пропускаем (не ошибка)
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        errors.push(`${manifestPath}: invalid JSON (${(e as Error).message})`);
        continue;
      }

      const result = validateManifest(parsed);
      if (!result.ok) {
        errors.push(`${manifestPath}: ${result.error}`);
        continue;
      }

      found.push({ manifest: result.manifest, installDir, manifestPath });
    }
  }

  return { found, errors };
}

// readdirSync только каталогов; любой сбой (нет пути, нет прав) → пусто.
function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
