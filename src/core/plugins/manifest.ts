// Манифест Loom-плагина (plugin.json в корне пакета) + структурный валидатор.
// Решения зафиксированы в .docs/loom/plugin-manifest.md (Task 8.1). Это имплементация 8.2.

export interface LoomPluginManifest {
  // идентификация
  schemaVersion: 1; // версия формата манифеста
  type: "loom-plugin"; // дискриминатор
  name: string; // = LoomPlugin.id, уникален
  title: string; // отображаемое
  version: string; // semver кода плагина
  apiVersion: string; // версия контракта LoomPlugin ("^1.0")
  description?: string;
  author?: { name: string; email?: string; url?: string };
  keywords?: string[];

  // загрузка кода
  entry: string; // путь к собранному ESM, напр "./dist/adapter.js"
  export?: string; // имя экспорта, default "plugin"

  // что привносит — для preview/меню/прав ДО динамического import()
  provides: {
    tabs: { id: string; title: string }[];
    settings?: boolean;
    actions?: { id: string; label: string }[];
  };

  // права (декларативно; формат verb:target). v1 — хранятся+показываются, НЕ enforced.
  permissions?: string[];

  // связь с реальным CC-плагином
  claudePlugin?: {
    name: string;
    marketplace: string;
    source?: string | { source: "github"; repo: string };
  };
}

// Версия контракта LoomPlugin, под который собран хост.
// 8.3 будет сверять apiVersion манифеста с этой константой (semver). Тут НЕ используется.
export const LOOM_CONTRACT_VERSION = "1.0";

export type ValidateResult =
  | { ok: true; manifest: LoomPluginManifest }
  | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// Чистая, defensive — НЕ бросает. Проверяет только структуру (не semver apiVersion).
// Неизвестные/лишние поля игнорируются (forward-compat).
export function validateManifest(raw: unknown): ValidateResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "manifest must be an object" };
  }
  const m = raw as Record<string, unknown>;

  if (m.type !== "loom-plugin") {
    return { ok: false, error: 'type must be "loom-plugin"' };
  }
  if (m.schemaVersion !== 1) {
    return { ok: false, error: "schemaVersion must be 1" };
  }
  if (!isNonEmptyString(m.name)) {
    return { ok: false, error: "name must be a non-empty string" };
  }
  if (!isNonEmptyString(m.title)) {
    return { ok: false, error: "title must be a non-empty string" };
  }
  if (!isNonEmptyString(m.version)) {
    return { ok: false, error: "version must be a non-empty string" };
  }
  if (!isNonEmptyString(m.apiVersion)) {
    return { ok: false, error: "apiVersion must be a non-empty string" };
  }
  if (!isNonEmptyString(m.entry)) {
    return { ok: false, error: "entry must be a non-empty string" };
  }

  const provides = m.provides;
  if (typeof provides !== "object" || provides === null || Array.isArray(provides)) {
    return { ok: false, error: "provides must be an object" };
  }
  const tabs = (provides as Record<string, unknown>).tabs;
  if (!Array.isArray(tabs)) {
    return { ok: false, error: "provides.tabs must be an array" };
  }
  for (const tab of tabs) {
    if (typeof tab !== "object" || tab === null || Array.isArray(tab)) {
      return { ok: false, error: "provides.tabs entries must be objects" };
    }
    const t = tab as Record<string, unknown>;
    if (!isNonEmptyString(t.id) || !isNonEmptyString(t.title)) {
      return { ok: false, error: "provides.tabs entries must have id and title" };
    }
  }

  return { ok: true, manifest: raw as LoomPluginManifest };
}
