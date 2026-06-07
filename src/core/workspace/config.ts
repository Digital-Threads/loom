import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

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
