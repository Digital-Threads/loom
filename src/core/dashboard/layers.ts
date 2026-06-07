import type { LoomPlugin } from "../plugins/types.js";

export const LAYER_ORDER = [
  "accounts", "efficiency", "memory",
  "learning", "knowledge", "quality", "automation", "observability", "undefined",
] as const;
export type Layer = (typeof LAYER_ORDER)[number];

const ID_FALLBACK: Record<string, Layer> = {
  aimux: "accounts",
  "token-pilot": "efficiency",
  "task-journal": "memory",
};

export function layerOf(plugin: Pick<LoomPlugin, "id"> & { category?: string }): Layer {
  const c = (plugin as { category?: string }).category;
  if (c && (LAYER_ORDER as readonly string[]).includes(c)) return c as Layer;
  return ID_FALLBACK[plugin.id] ?? "undefined";
}

export function layerLabel(layer: Layer): string {
  const map: Record<Layer, string> = {
    accounts: "Доступ / аккаунты",
    efficiency: "Эффективность / токены",
    memory: "Память / задачи",
    learning: "Обучение",
    knowledge: "Знания",
    quality: "Качество",
    automation: "Автоматизация",
    observability: "Наблюдаемость",
    undefined: "Прочее",
  };
  return map[layer];
}
