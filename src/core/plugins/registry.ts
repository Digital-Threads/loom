import type { LoomPlugin } from "./types.js";

export interface Registry {
  list(): LoomPlugin[];
  get(id: string): LoomPlugin | undefined;
  // Registers a plugin if the id is not yet taken -> true. If the id already exists --
  // does NOT overwrite (builtin takes priority over dynamic in Phase 8) -> false.
  register(plugin: LoomPlugin): boolean;
  // Groups plugins by category in registration order.
  // Plugins without a category -> key "undefined". Returns Map<category|"undefined", LoomPlugin[]>.
  groupByCategory(): Map<string, LoomPlugin[]>;
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
    groupByCategory: () => {
      const groups = new Map<string, LoomPlugin[]>();
      for (const p of byId.values()) {
        const key = p.category ?? "undefined";
        const bucket = groups.get(key) ?? [];
        bucket.push(p);
        groups.set(key, bucket);
      }
      return groups;
    },
  };
}
