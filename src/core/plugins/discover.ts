import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest, type LoomPluginManifest } from "./manifest.js";

export interface DiscoveredManifest {
  manifest: LoomPluginManifest;
  installDir: string; // directory holding plugin.json (<name>/<version>)
  manifestPath: string;
}

// Scan <pluginsDir>/<name>/<version>/plugin.json. Defensive:
//  - a nonexistent directory -> {found:[], errors:[]} (do NOT throw)
//  - corrupt JSON / invalid manifest -> an entry in errors, skip
//  - one corrupt folder does not break the whole scan
// Duplicate names are NOT resolved here (that is 8.3 when building the registry) -- we return everything.
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
        // no plugin.json in this directory -- just skip (not an error)
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

// readdirSync of directories only; any failure (no path, no permissions) -> empty.
function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
