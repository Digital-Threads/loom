// D2 / L11.4 — `loom plugin new <name>`: write the scaffolded plugin to disk.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { scaffoldPlugin } from "../core/extensibility/scaffold.js";

/** Write the scaffold files under destDir; returns the relative paths written. */
export function runPluginNew(name: string, destDir: string): string[] {
  const files = scaffoldPlugin(name);
  for (const f of files) {
    const p = join(destDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
  return files.map((f) => f.path);
}
