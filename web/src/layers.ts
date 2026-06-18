// Maps a layer id (from src/core/dashboard/layer-catalog.ts) to the menu section
// key its card opens when clicked in the Layers view. Only layers that have their
// own section in the sidebar appear here; the rest stay non-clickable.
// Note: a layer id and its section key are NOT always equal — e.g. token-pilot's
// layer id is "efficiency" but its section is "tokens".
export const LAYER_SECTION: Record<string, string> = {
  accounts: "accounts",
  efficiency: "tokens",
  memory: "memory",
  security: "security",
  quality: "quality",
  swarm: "swarm",
  knowledge: "knowledge",
  observability: "timeline",
  automation: "board",
};

/** Menu section a layer card opens, or undefined when the layer has no section. */
export function layerSection(id: string): string | undefined {
  return LAYER_SECTION[id];
}
