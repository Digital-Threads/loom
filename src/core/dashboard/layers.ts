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

export interface LayerTab { pluginId: string; tabId: string; title: string }
export interface LayerGroup { layer: Layer; label: string; tabs: LayerTab[] }

export function groupTabsByLayer(
  plugins: Array<Pick<LoomPlugin, "id" | "tabs"> & { category?: string }>,
): LayerGroup[] {
  const byLayer = new Map<Layer, LayerTab[]>();
  for (const p of plugins) {
    const layer = layerOf(p);
    const tabs = p.tabs.map((t) => ({ pluginId: p.id, tabId: t.id, title: t.title }));
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), ...tabs]);
  }
  return LAYER_ORDER
    .filter((l) => byLayer.has(l) && byLayer.get(l)!.length > 0)
    .map((l) => ({ layer: l, label: layerLabel(l), tabs: byLayer.get(l)! }));
}
