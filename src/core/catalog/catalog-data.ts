import type { CatalogEntry } from "./types.js";

// The only thing the catalog hardcodes about "our 3" -- the product case.
// category comes from the registry (LP1), recipe -- from the plugin.json manifest (LP2).
export const CATALOG_ENTRIES: CatalogEntry[] = [
  { id: "aimux",        title: "aimux",
    case: "Multiple AI subscriptions: profiles, auth, sessions in one TUI" },
  { id: "token-pilot",  title: "Token Pilot",
    case: "Save tokens when reading code + spend stats" },
  { id: "task-journal", title: "Task Journal",
    case: "Task memory: hypotheses, decisions, rejected approaches, outcome" },
];
