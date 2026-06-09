import {
  loadConfig,
  saveConfig,
  addProfile,
  checkAllProfiles,
  unifyAllSessions,
  launchProfile,
  getProfile,
  saveActiveProfile,
  type HealthReport,
} from "@digital-threads/aimux/core";
import type { SettingsSchema, LoomPlugin, ViewSpec } from "../contract.js";

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

// the aimux config is profile-like (cli/model/env per profile) -- this is actions (add subscription),
// not flat settings. aimux has no flat global settings -> the schema is empty.
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
    if (!cfg) return { ok: false, error: "no aimux config" };
    const updated = addProfile(cfg, name, opts);
    saveConfig(updated);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// the plugin object is assembled from the existing functions above -- no new logic.
export const plugin: LoomPlugin<{
  subscriptions: Subscription[];
  sessions: SessionRow[];
  health: HealthReport[];
}> = {
  id: "aimux",
  title: "aimux",
  category: "accounts",
  capabilities: { install: false, data: true, settings: false, actions: true },
  tabs: [
    { id: "subscriptions", title: "Subscriptions" },
    { id: "sessions", title: "Sessions" },
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
      label: "Add subscription",
      prompt: [{ key: "name", label: "Profile name" }],
      run: (_ctx, args) =>
        addSubscription(
          String(args?.name ?? ""),
          (args?.opts as { cli?: string; model?: string; fallbackModel?: string }) ?? {},
        ),
    },
    {
      id: "login",
      label: "Login (launchProfile)",
      prompt: [{ key: "profile", label: "Profile to log in" }],
      run: (_ctx, args) => {
        const profile = String(args?.profile ?? "").trim();
        if (!profile) return { ok: false, error: "no profile selected" };
        return {
          ok: true,
          handover: () => {
            const cfg = loadConfig();
            if (!cfg) throw new Error("no aimux config");
            return launchProfile(cfg, profile);
          },
        };
      },
    },
    {
      id: "switchProfile",
      label: "Switch active profile",
      prompt: [{ key: "profile", label: "Active profile" }],
      run: (_ctx, args) => {
        const profile = String(args?.profile ?? "").trim();
        if (!profile) return { ok: false, error: "no profile specified" };
        try {
          const cfg = loadConfig();
          if (!cfg) return { ok: false, error: "no aimux config" };
          // getProfile throws if the profile is missing -> we check explicitly to return a clear error.
          if (!cfg.profiles[profile]) return { ok: false, error: `profile not found: ${profile}` };
          getProfile(cfg, profile);
          saveActiveProfile(profile);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    },
  ],
  // Declarative tab views (Task 7.4) -- exact reproduction of Subscriptions/SessionsPanel.
  views: {
    // SubscriptionsPanel: "{star|space} {name.padEnd(14)} {cli}" -- gap=1 gives exactly 1 space before cli.
    subscriptions: {
      kind: "table",
      source: "subscriptions",
      rowKey: "name",
      gap: 1,
      empty: "No subscriptions",
      actions: [
        { key: "a", actionId: "addSubscription" },
        { key: "l", actionId: "login" },
        { key: "s", actionId: "switchProfile" },
      ],
      columns: [
        { value: "name", width: 14, marker: { when: "isSource", truthy: "★", falsy: " " } },
        { value: "cli" },
      ],
    } satisfies ViewSpec,
    // SessionsPanel: "{id8}  {profile.padEnd(12)} {used/saved}" -- profileTokens joins
    // profile.padEnd(12)+" "+tokens; gap=2 gives 2 spaces after the id (as in the panel).
    sessions: {
      kind: "table",
      source: { fn: "sessionRows" },
      rowKey: "sessionId",
      gap: 2,
      empty: "No sessions",
      columns: [{ value: "idShort" }, { value: "profileTokens" }],
    } satisfies ViewSpec,
  },
};
