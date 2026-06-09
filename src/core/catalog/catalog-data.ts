import type { CatalogEntry } from "./types.js";

// Единственное, что каталог хардкодит про «наши 3» — продуктовый кейс.
// category берётся из реестра (LP1), recipe — из манифеста plugin.json (LP2).
export const CATALOG_ENTRIES: CatalogEntry[] = [
  { id: "aimux",        title: "aimux",
    case: "Multiple AI subscriptions: profiles, auth, sessions in one TUI" },
  { id: "token-pilot",  title: "Token Pilot",
    case: "Save tokens when reading code + spend stats" },
  { id: "task-journal", title: "Task Journal",
    case: "Task memory: hypotheses, decisions, rejected approaches, outcome" },
];
