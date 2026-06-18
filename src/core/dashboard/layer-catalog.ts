// The full Loom layer architecture (System Bible §2 "Модель слоёв"): 3 layers
// already extracted to standalone plugins, plus the inline layers that live in
// loom-host/src/core/* and are slated to become standalone packages in Phase 2.
// The Layers view shows ALL of them — not just the registered plugins — so the
// roadmap (what's standalone vs still inline) is visible.

export type LayerStatus = "standalone" | "inline";

export interface LayerCatalogEntry {
  /** Layer id (matches LAYER_ORDER where applicable). */
  id: string;
  label: string;
  /** The node/package name for this layer (plugin id or core module). */
  node: string;
  status: LayerStatus;
  /** Plugin id when extracted (links to its module view); undefined for inline. */
  plugin?: string;
  /** Where it lives today. */
  source: string;
  description: string;
}

export const LAYER_CATALOG: LayerCatalogEntry[] = [
  // ── standalone plugins (own package + repo, installed separately) ──
  { id: "accounts", label: "Access / accounts", node: "aimux", status: "standalone", plugin: "aimux", source: "plugin", description: "CLI subscriptions and accounts, running sessions under a profile." },
  { id: "efficiency", label: "Efficiency / tokens", node: "token-pilot", status: "standalone", plugin: "token-pilot", source: "plugin", description: "Token savings: cheap code reads, usage accounting." },
  { id: "memory", label: "Memory / tasks", node: "task-journal", status: "standalone", plugin: "task-journal", source: "plugin", description: "Task journal — history of decisions, findings, rejections." },
  // ── inline modules (in loom-host/src/core; may become plugins later) ──
  { id: "security", label: "Security", node: "loom-security", status: "inline", source: "core/layers/security/*", description: "Agent sandbox: worktree isolation, command policy, secret scanning, audit." },
  { id: "quality", label: "Quality", node: "loom-quality", status: "inline", source: "core/layers/quality/*", description: "AI code review (self/ralph/adversarial) + quality checks." },
  { id: "swarm", label: "Swarm", node: "loom-swarm", status: "inline", source: "core/layers/swarm/*", description: "Multi-agent coordinator (several agents per task)." },
  { id: "automation", label: "Automation", node: "automation", status: "inline", source: "core/automation/*", description: "Task sessions, pipeline, conductor (the Loom engine)." },
  { id: "knowledge", label: "Knowledge", node: "knowledge", status: "inline", source: "core/knowledge/*", description: "Recall 'we solved this before' at the analysis stage." },
  { id: "learning", label: "Learning", node: "learning", status: "inline", source: "core/learning/*", description: "Learning from past task history." },
  { id: "observability", label: "Observability", node: "observability", status: "inline", source: "core/observability/*", description: "Cost rollups, metrics, event timeline." },
];
