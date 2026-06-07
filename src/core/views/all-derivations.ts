import type { WorkspaceData } from "../data/loader.js";
import { derivations as hostDerivations } from "./derivations.js";
import { loomRegistry } from "../plugins/index.js";

export type DerivationFn = (data: WorkspaceData, ...args: any[]) => unknown;

// Объединённая карта деривлаций для резолвера {fn}: host-built-in + деривации всех
// зарегистрированных плагинов. Плагины ДОПОЛНЯЮТ карту; host-built-in приоритетнее —
// при коллизии имени host-версия не перекрывается (мержим плагины первыми, host сверху).
export function allDerivations(): Record<string, DerivationFn> {
  const merged: Record<string, DerivationFn> = {};
  for (const p of loomRegistry.list()) {
    for (const [name, fn] of Object.entries(p.derivations ?? {})) {
      merged[name] = fn as DerivationFn;
    }
  }
  return { ...merged, ...hostDerivations };
}
