import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const CONFIG_FILE = ".ai-workspace.yaml";

export interface WorkspaceProfile { provider?: string; profile?: string; model?: string; }
export interface PluginConfig { enabled?: boolean; [key: string]: unknown; }
export interface AiWorkspaceConfig {
  version: number;
  workspace: { name?: string; project_id?: string; root?: string };
  profiles: Record<string, WorkspaceProfile>;
  plugins: Record<string, PluginConfig>;
}

export function defaultConfig(): AiWorkspaceConfig {
  return { version: 1, workspace: {}, profiles: {}, plugins: {} };
}

export function readWorkspaceConfig(projectRoot: string): AiWorkspaceConfig {
  let parsed: unknown;
  try {
    const raw = readFileSync(join(projectRoot, CONFIG_FILE), "utf8");
    parsed = parse(raw);
  } catch {
    return defaultConfig();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultConfig();
  const obj = parsed as Record<string, unknown>;
  const base = defaultConfig();
  return {
    version: typeof obj.version === "number" ? obj.version : base.version,
    workspace: obj.workspace && typeof obj.workspace === "object" && !Array.isArray(obj.workspace)
      ? (obj.workspace as AiWorkspaceConfig["workspace"]) : base.workspace,
    profiles: obj.profiles && typeof obj.profiles === "object" && !Array.isArray(obj.profiles)
      ? (obj.profiles as AiWorkspaceConfig["profiles"]) : base.profiles,
    plugins: obj.plugins && typeof obj.plugins === "object" && !Array.isArray(obj.plugins)
      ? (obj.plugins as AiWorkspaceConfig["plugins"]) : base.plugins,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  }
  return out;
}
export function writeWorkspaceConfig(
  projectRoot: string,
  patch: Partial<AiWorkspaceConfig> & Record<string, unknown>,
): boolean {
  try {
    const file = join(projectRoot, CONFIG_FILE);
    let current: Record<string, unknown> = { version: 1 };
    try {
      const raw = parse(readFileSync(file, "utf8"));
      if (isPlainObject(raw)) current = raw;
    } catch { /* нет файла / битый — стартуем с минимума */ }
    const merged = deepMerge(current, patch as Record<string, unknown>);
    if (typeof merged.version !== "number") merged.version = 1;
    writeFileSync(file, stringify(merged), "utf8");
    return true;
  } catch {
    return false;
  }
}
