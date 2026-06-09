import type { LoomPlugin } from "../plugins/types.js";
import type { WorkspaceData } from "../data/loader.js";

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
    accounts: "Access / accounts",
    efficiency: "Efficiency / tokens",
    memory: "Memory / tasks",
    learning: "Learning",
    knowledge: "Knowledge",
    quality: "Quality",
    automation: "Automation",
    observability: "Observability",
    undefined: "Other",
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

// Плоский список плагинных вкладок, сгруппированных по слою (порядок LAYER_ORDER).
export function buildPluginTabs(
  plugins: Array<Pick<LoomPlugin, "id" | "tabs"> & { category?: string }>,
): LayerTab[] {
  return groupTabsByLayer(plugins).flatMap((g) => g.tabs);
}

// По-слойная сводка для обзора: одна строка на присутствующий слой, в порядке LAYER_ORDER.
export function layerSummary(data: WorkspaceData): Array<{ text: string }> {
  const lines: Array<{ text: string }> = [];
  const subs = data.subscriptions?.length ?? 0;
  const sess = data.sessions?.length ?? 0;
  if (subs > 0 || sess > 0) lines.push({ text: `${layerLabel("accounts")}: Subscriptions ${subs} · Sessions ${sess}` });
  const used = (data.tokenEvents ?? []).reduce((s, e: any) => s + (e.used ?? 0), 0);
  const saved = (data.tokenEvents ?? []).reduce((s, e: any) => s + (e.saved ?? 0), 0);
  if (used > 0 || saved > 0) lines.push({ text: `${layerLabel("efficiency")}: Spent ${used} · Saved ${saved}` });
  const taskN = data.tasks?.length ?? 0;
  if (taskN > 0) lines.push({ text: `${layerLabel("memory")}: Tasks ${taskN}` });
  return lines;
}
