import type { CatalogEntry } from "./types.js";

// Единственное, что каталог хардкодит про «наши 3» — продуктовый кейс.
// category берётся из реестра (LP1), recipe — из манифеста plugin.json (LP2).
export const CATALOG_ENTRIES: CatalogEntry[] = [
  { id: "aimux",        title: "aimux",
    case: "Несколько AI-подписок: профили, auth, сессии в одной TUI" },
  { id: "token-pilot",  title: "Token Pilot",
    case: "Экономия токенов при чтении кода + статистика трат" },
  { id: "task-journal", title: "Task Journal",
    case: "Память задач: гипотезы, решения, отвергнутые подходы, итог" },
];
