import { join } from "node:path";
import type { ScopeDirs, ScopeName } from "./types.js";
export const SCOPES: ScopeName[] = ["user", "project", "local"];
export function settingsPathForScope(scope: ScopeName, dirs: ScopeDirs): string {
  const claude = (base: string) => join(base, ".claude");
  switch (scope) {
    case "user": return join(claude(dirs.homeDir), "settings.json");
    case "project": return join(claude(dirs.projectDir), "settings.json");
    case "local": return join(claude(dirs.projectDir), "settings.local.json");
  }
}
