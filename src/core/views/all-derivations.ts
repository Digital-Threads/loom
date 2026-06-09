import type { WorkspaceData } from "../data/loader.js";
import { derivations as hostDerivations } from "./derivations.js";
import { loomRegistry } from "../plugins/index.js";

export type DerivationFn = (data: WorkspaceData, ...args: any[]) => unknown;

// Combined derivations map for the {fn} resolver: host built-in + derivations of all
// registered plugins. Plugins ADD to the map; host built-in takes priority --
// on a name collision the host version is not overwritten (we merge plugins first, host on top).
export function allDerivations(): Record<string, DerivationFn> {
  const merged: Record<string, DerivationFn> = {};
  for (const p of loomRegistry.list()) {
    for (const [name, fn] of Object.entries(p.derivations ?? {})) {
      merged[name] = fn as DerivationFn;
    }
  }
  return { ...merged, ...hostDerivations };
}
