// Манифест Loom-плагина (plugin.json в корне пакета) + структурный валидатор.
// Решения зафиксированы в .docs/loom/plugin-manifest.md (Task 8.1). Это имплементация 8.2.
//
// Phase 9.1: тип LoomPluginManifest переехал в @digital-threads/loom-contract.
// LOOM_CONTRACT_VERSION и validateManifest — рантайм-логика хоста, остаются здесь.
import type { LoomPluginManifest } from "@digital-threads/loom-contract";

// Re-export типа для обратной совместимости существующих импортёров manifest.ts.
export type { LoomPluginManifest } from "@digital-threads/loom-contract";

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
