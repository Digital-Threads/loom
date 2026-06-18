// ClaudeRuntime — the single AgentRuntime implementation. ALL Claude-specific
// wiring lives here: spawning `claude` via aimux (live launcher), reading the
// host's ~/.claude/skills library, the Loom MCP connectors + beads import, and
// optional recall. The host config ~/.claude is read-only and only touched here.

import type { AgentRuntime } from "./agent-runtime.js";
import type { SessionLauncher } from "../automation/task-session.js";
import type { SessionControl } from "../automation/live-session.js";
import type { RecallHit } from "../knowledge/recall.js";
import { createAimuxLiveLauncher } from "../automation/aimux-session-launcher.js";
import { listSkills, readSkill, writeSkill, deleteSkill, generateSkill } from "../skills/skills.js";
import { listMcp } from "../connectors/mcp.js";
import { beadsConnector } from "../connectors/beads.js";

export interface ClaudeRuntimeDeps {
  /** OS-sandbox toggle, resolved per spawn (see aimux launcher). */
  sandbox?: boolean | (() => boolean);
  /** Override the launcher (tests). Default: live aimux launcher. */
  launcher?: SessionLauncher & SessionControl;
  /** Optional recall — wired by the API with the project root in scope. */
  recall?: (query: string) => RecallHit[];
}

export function createClaudeRuntime(deps: ClaudeRuntimeDeps = {}): AgentRuntime {
  return {
    id: "claude",
    launcher: deps.launcher ?? createAimuxLiveLauncher({ sandbox: deps.sandbox }),
    skills: {
      list: listSkills,
      read: readSkill,
      write: writeSkill,
      delete: deleteSkill,
      generate: generateSkill,
    },
    connectors: {
      listMcp,
      importDrafts: () => beadsConnector().import(),
    },
    recall: deps.recall,
  };
}
