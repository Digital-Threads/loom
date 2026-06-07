import type { LoomPlugin } from "./types.js";

export interface Registry {
  list(): LoomPlugin[];
  get(id: string): LoomPlugin | undefined;
}

export function createRegistry(plugins: LoomPlugin[]): Registry {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  return {
    list: () => [...byId.values()],
    get: (id) => byId.get(id),
  };
}
