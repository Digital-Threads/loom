import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { LOOM_CONTRACT_VERSION } from "./manifest.js";
import type { DiscoveredManifest } from "./discover.js";
import type { LoomPlugin } from "./types.js";

// Extracts the major version from a semver-like string. Supports
// "1.0", "^1.0", "~1.2.3", "1". Garbage -> null.
function majorOf(version: string): number | null {
  const m = /^[\^~]?\s*(\d+)/.exec(version.trim());
  if (!m) return null;
  return Number(m[1]);
}

// Pure function: compatible if the major matches. Garbage on either side -> false.
export function isApiCompatible(pluginApiVersion: string, hostVersion: string): boolean {
  const a = majorOf(pluginApiVersion);
  const b = majorOf(hostVersion);
  if (a === null || b === null) return false;
  return a === b;
}

// Dynamically imports and validates the discovered plugins.
// EACH module in its own try/catch -- one corrupt/failing module does not break the rest.
export async function loadPlugins(
  discovered: DiscoveredManifest[],
): Promise<{ plugins: LoomPlugin[]; errors: string[] }> {
  const plugins: LoomPlugin[] = [];
  const errors: string[] = [];

  for (const { manifest, installDir } of discovered) {
    const name = manifest.name;

    // apiVersion semver compatibility before loading the code.
    if (!isApiCompatible(manifest.apiVersion, LOOM_CONTRACT_VERSION)) {
      errors.push(
        `${name}: apiVersion ${manifest.apiVersion} is incompatible with host ${LOOM_CONTRACT_VERSION}`,
      );
      continue;
    }

    const abs = isAbsolute(manifest.entry)
      ? manifest.entry
      : join(installDir, manifest.entry);
    const exportName = manifest.export ?? "plugin";

    let mod: Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    } catch (e) {
      errors.push(`${name}: failed to import ${abs} (${(e as Error).message})`);
      continue;
    }

    const plugin = mod[exportName] as LoomPlugin | undefined;

    if (!plugin || typeof plugin !== "object") {
      errors.push(`${name}: export "${exportName}" not found in ${abs}`);
      continue;
    }
    if (plugin.id !== name) {
      errors.push(
        `${name}: plugin.id "${plugin.id}" does not match manifest name "${name}"`,
      );
      continue;
    }
    if (!Array.isArray(plugin.tabs)) {
      errors.push(`${name}: plugin.tabs must be an array`);
      continue;
    }
    if (typeof plugin.load !== "function") {
      errors.push(`${name}: plugin.load must be a function`);
      continue;
    }

    plugins.push(plugin);
  }

  return { plugins, errors };
}
