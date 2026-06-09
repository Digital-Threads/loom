import { homedir } from "node:os";
import { join } from "node:path";

// Loom directories. Pure functions -- they do NOT create directories.
// LOOM_DATA = $XDG_DATA_HOME/loom if set, otherwise ~/.loom (see plugin-manifest.md).

export function loomDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  return xdg ? join(xdg, "loom") : join(homedir(), ".loom");
}

export function loomPluginsDir(): string {
  return join(loomDataDir(), "plugins");
}

export function loomRegistryFile(): string {
  return join(loomDataDir(), "plugins.json");
}
