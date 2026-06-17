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
  // ── standalone plugins (own @digital-threads/loom-* package + repo) ──
  { id: "accounts", label: "Access / accounts", node: "aimux", status: "standalone", plugin: "aimux", source: "plugin", description: "Подписки и аккаунты CLI, запуск сессий под профилем." },
  { id: "efficiency", label: "Efficiency / tokens", node: "token-pilot", status: "standalone", plugin: "token-pilot", source: "plugin", description: "Экономия токенов: дешёвое чтение кода, учёт расхода." },
  { id: "memory", label: "Memory / tasks", node: "task-journal", status: "standalone", plugin: "task-journal", source: "plugin", description: "Журнал задач — история решений, находок, отклонений." },
  { id: "security", label: "Security", node: "loom-security", status: "standalone", source: "@digital-threads/loom-security", description: "Песочница для агента: worktree-изоляция, политика команд, скан секретов, аудит." },
  { id: "quality", label: "Quality", node: "loom-quality", status: "standalone", source: "@digital-threads/loom-quality", description: "AI-ревью кода (self/ralph/adversarial) + прогон проверок." },
  { id: "swarm", label: "Swarm", node: "loom-swarm", status: "standalone", source: "@digital-threads/loom-swarm", description: "Координатор мульти-агента (несколько агентов на задачу)." },
  // ── inline modules (in loom-host/src/core; могут стать плагинами позже) ──
  { id: "automation", label: "Automation", node: "automation", status: "inline", source: "core/automation/*", description: "Сессии задач, конвейер, дирижёр (движок Loom)." },
  { id: "knowledge", label: "Knowledge", node: "knowledge", status: "inline", source: "core/knowledge/*", description: "Recall «уже решали это» на стадии анализа." },
  { id: "learning", label: "Learning", node: "learning", status: "inline", source: "core/learning/*", description: "Обучение на истории прошлых задач." },
  { id: "observability", label: "Observability", node: "observability", status: "inline", source: "core/observability/*", description: "Cost-rollups, метрики, timeline событий." },
];
