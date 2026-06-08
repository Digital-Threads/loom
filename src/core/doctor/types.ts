export type ScopeName = "user" | "project" | "local";
export interface ScopeDirs { homeDir: string; projectDir: string; }
export interface PluginContribution {
  plugin: string;
  hooks?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  statusLine?: unknown;
}
export interface DoctorReport {
  scope: ScopeName;
  ok: boolean;
  missingMcp: string[];
  changedMcp: string[];
  missingHookEvents: string[];
  mcpCollisions: Array<{ server: string; plugins: string[]; values?: unknown[] }>;
  hookCollisions: Array<{ event: string; plugins: string[] }>;
}
