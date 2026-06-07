import { homedir } from "node:os";
import { join } from "node:path";

// Директории Loom. Чистые функции — НЕ создают каталоги.
// LOOM_DATA = $XDG_DATA_HOME/loom если задан, иначе ~/.loom (см. plugin-manifest.md).

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
