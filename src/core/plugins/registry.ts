import type { LoomPlugin } from "./types.js";

export interface Registry {
  list(): LoomPlugin[];
  get(id: string): LoomPlugin | undefined;
  // Регистрирует плагин если id ещё не занят → true. Если id уже есть —
  // НЕ перезаписывает (builtin приоритетнее динамического в Phase 8) → false.
  register(plugin: LoomPlugin): boolean;
}

export function createRegistry(plugins: LoomPlugin[]): Registry {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  return {
    list: () => [...byId.values()],
    get: (id) => byId.get(id),
    register: (plugin) => {
      if (byId.has(plugin.id)) return false;
      byId.set(plugin.id, plugin);
      return true;
    },
  };
}
