// AgentRuntime — the seam that makes the agent engine swappable. The pipeline
// and the web API depend on THIS interface, never on the word "claude". Today
// there is exactly one implementation (ClaudeRuntime); other engines come later
// behind the same contract. Everything engine-specific (spawning `claude`,
// reading ~/.claude/skills, the MCP connectors, recall) lives behind here.

import type { SessionLauncher } from "../automation/task-session.js";
import type { SessionControl } from "../automation/live-session.js";
import type { SkillMeta } from "../skills/skills.js";
import type { McpServer } from "../connectors/mcp.js";
import type { TaskDraft } from "../connectors/connector.js";
import type { RecallHit } from "../knowledge/recall.js";

/** The engine's skill library (browse / read / edit / AI-generate). */
export interface SkillsProvider {
  list(): SkillMeta[];
  read(name: string): string | null;
  write(name: string, content: string): boolean;
  delete(name: string): boolean;
  generate(
    description: string,
    agent: (prompt: string) => Promise<string>,
  ): Promise<{ name: string; content: string } | null>;
}

/** The engine's connectors — MCP servers it exposes plus tracker imports. The
 *  LIST surface only; mutating Loom's own mcp.json is config management, not the
 *  engine, so it stays outside the runtime. */
/** Which connector to import from, and its parameters (e.g. a GitHub repo). */
export interface ImportOptions {
  /** Connector id from the registry (default: "beads"). */
  connector?: string;
  /** Repository ("owner/repo") for connectors that need one (e.g. github). */
  repo?: string;
}

export interface ConnectorsProvider {
  listMcp(): McpServer[];
  importDrafts(opts?: ImportOptions): TaskDraft[];
}

/** A swappable agent engine. One implementation today: ClaudeRuntime. */
export interface AgentRuntime {
  /** Engine id for logs/diagnostics, e.g. "claude". */
  readonly id: string;
  /** (a) Run/keep an agent session — one long-lived launcher with its control
   *  surface (cost/denials/interject/stop). */
  readonly launcher: SessionLauncher & SessionControl;
  /** (b) Skill library. */
  readonly skills: SkillsProvider;
  /** (c) Connectors (MCP servers + tracker imports). */
  readonly connectors: ConnectorsProvider;
  /** (d) Optional recall of prior reasoning for a query. */
  readonly recall?: (query: string) => RecallHit[];
}
