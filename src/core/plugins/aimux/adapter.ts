import {
  loadConfig,
  saveConfig,
  addProfile,
  checkAllProfiles,
  unifyAllSessions,
  type HealthReport,
} from "@digital-threads/aimux/core";
import type { SettingsSchema, LoomPlugin } from "../types.js";

export interface Subscription {
  name: string;
  cli: string;
  isSource: boolean;
}

export function listSubscriptions(): Subscription[] {
  const cfg = loadConfig();
  if (!cfg) return [];
  return Object.entries(cfg.profiles).map(([name, p]) => ({
    name,
    cli: p.cli,
    isSource: Boolean(p.is_source),
  }));
}

export function listHealth(): HealthReport[] {
  const cfg = loadConfig();
  if (!cfg) return [];
  return Array.from(checkAllProfiles(cfg).values());
}

export interface SessionRow {
  sessionId: string;
  profile: string;
  lastUsedAtMs?: number;
}

export function listSessions(): SessionRow[] {
  const cfg = loadConfig();
  if (!cfg) return [];
  return unifyAllSessions(cfg).map((s) => ({
    sessionId: s.sessionId,
    profile: s.lastProfile ?? "",
    lastUsedAtMs: s.updatedAtMs,
  }));
}

// aimux-конфиг профиле-образный (cli/model/env на профиль) — это actions (add subscription),
// а не плоские настройки. Плоских глобальных настроек у aimux нет → схема пустая.
export function settingsSchema(): SettingsSchema {
  return { fields: [] };
}

export interface AddSubscriptionResult {
  ok: boolean;
  error?: string;
}

export function addSubscription(
  name: string,
  opts: { cli?: string; model?: string; fallbackModel?: string } = {},
): AddSubscriptionResult {
  try {
    const cfg = loadConfig();
    if (!cfg) return { ok: false, error: "нет конфига aimux" };
    const updated = addProfile(cfg, name, opts);
    saveConfig(updated);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// plugin-объект собран из существующих функций выше — без новой логики.
export const plugin: LoomPlugin<{
  subscriptions: Subscription[];
  sessions: SessionRow[];
  health: HealthReport[];
}> = {
  id: "aimux",
  title: "aimux",
  tabs: [
    { id: "subscriptions", title: "Подписки" },
    { id: "sessions", title: "Сессии" },
  ],
  load: (_ctx) => ({
    subscriptions: listSubscriptions(),
    sessions: listSessions(),
    health: listHealth(),
  }),
  settings: {
    schema: settingsSchema(),
    read: () => ({}),
    write: () => false,
  },
  actions: [
    {
      id: "addSubscription",
      label: "Добавить подписку",
      run: (_ctx, args) =>
        addSubscription(
          String(args?.name ?? ""),
          (args?.opts as { cli?: string; model?: string; fallbackModel?: string }) ?? {},
        ),
    },
  ],
};
