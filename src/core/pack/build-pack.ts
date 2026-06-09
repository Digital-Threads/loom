import type { PackInput } from "./pack-input.js";
import { taskDetailFromEvents } from "../plugins/task-journal/adapter.js";
import { tokensForTask } from "../metrics/tokens-per-task.js";
import { tokenTotals } from "../views/derivations.js";

const UNAVAILABLE = (why: string) => `_unavailable: ${why}_`;
const RECENT = 5;

export function buildPack(input: PackInput): string {
  const sections = [
    sectionHeader(input),
    sectionProfile(input),
    sectionTask(input),
    sectionDecisions(input),
    sectionRejections(input),
    sectionTouchedFiles(input),
    sectionTokenUsage(input),
    sectionWorkflowBudget(input),
    sectionMcpHealth(input),
    sectionFooter(input),
  ];
  return sections.join("\n\n") + "\n";
}

function sectionHeader(input: PackInput): string {
  const name = input.config.projectName ?? "—";
  return `# Workspace pack\n\nProject: ${name}`;
}
function sectionProfile(input: PackInput): string {
  const explicit = input.config.activeProfile;
  if (explicit) return `## Active profile\n\n${explicit}`;
  const sess = [...input.data.sessions]
    .filter((s) => s.profile)
    .sort((a, b) => (b.lastUsedAtMs ?? 0) - (a.lastUsedAtMs ?? 0) || a.sessionId.localeCompare(b.sessionId))[0];
  if (sess) return `## Active profile\n\n${sess.profile} (heuristic: most recent session)`;
  return `## Active profile\n\n${UNAVAILABLE("no active profile")}`;
}
function resolveActiveTaskId(input: PackInput): { id: string; heuristic: boolean } | null {
  if (input.config.activeTaskId) return { id: input.config.activeTaskId, heuristic: false };
  const open = input.data.tasks.find((t) => t.status === "open");
  return open ? { id: open.id, heuristic: true } : null;
}
function sectionTask(input: PackInput): string {
  const r = resolveActiveTaskId(input);
  if (!r) return `## Active task\n\n${UNAVAILABLE("no active task")}`;
  const t = input.data.tasks.find((x) => x.id === r.id);
  const title = t?.title ?? "(not in journal)";
  const status = t?.status ?? "?";
  const tag = r.heuristic ? " (heuristic: first open)" : "";
  return `## Active task\n\n${r.id} — ${title} [${status}]${tag}`;
}
function sectionDecisions(input: PackInput): string {
  const r = resolveActiveTaskId(input);
  if (!r) return `## Recent decisions\n\n${UNAVAILABLE("no active task")}`;
  const { decisions } = taskDetailFromEvents(input.data.taskEvents, r.id);
  if (decisions.length === 0) return "## Recent decisions\n\n_no recorded decisions_";
  return "## Recent decisions\n\n" + decisions.slice(-RECENT).map((e) => `- ${e.text}`).join("\n");
}
function sectionRejections(input: PackInput): string {
  const r = resolveActiveTaskId(input);
  if (!r) return `## Rejected approaches\n\n${UNAVAILABLE("no active task")}`;
  const { rejections } = taskDetailFromEvents(input.data.taskEvents, r.id);
  if (rejections.length === 0) return "## Rejected approaches\n\n_no rejected approaches_";
  return "## Rejected approaches\n\n" + rejections.map((e) => `- ${e.text}`).join("\n");
}
function sectionTouchedFiles(_input: PackInput): string { return `## Touched files\n\n${UNAVAILABLE("no layer reports a file list")}`; }
function sectionTokenUsage(input: PackInput): string {
  if (input.data.tokens.length === 0)
    return `## Token usage\n\n${UNAVAILABLE("no token data")}`;
  const total = tokenTotals(input.data);
  const lines = [`Project total: spent ${total.used} · saved ${total.saved}`];
  const r = resolveActiveTaskId(input);
  if (r) {
    const t = tokensForTask(input.data.taskEvents, r.id, input.data.tokenEvents);
    lines.push(`Active task: spent ${t.used} · saved ${t.saved} (time-based estimate)`);
  }
  return "## Token usage\n\n" + lines.join("\n");
}
function sectionWorkflowBudget(_input: PackInput): string { return `## Workflow budget\n\n${UNAVAILABLE("no workflow budget source")}`; }
function sectionMcpHealth(input: PackInput): string {
  const lines: string[] = [];
  for (const h of input.data.health) {
    const bad = h.broken.length + h.missing.length + h.conflicts.length;
    lines.push(bad === 0 ? `- ${h.profile}: ok`
      : `- ${h.profile}: problems — broken ${h.broken.length}, missing ${h.missing.length}, conflicts ${h.conflicts.length}`);
  }
  if (input.data.errors.length) {
    lines.push("", "Layer load errors:");
    for (const e of input.data.errors) lines.push(`- ${e}`);
  }
  const body = lines.length ? lines.join("\n") : "all layers returned data without errors";
  return "## MCP / environment health\n\n" + body;
}
function sectionFooter(_input: PackInput): string {
  return "---\n_Per-task tokens are an estimate over the task's event time window (LP4); double-count is possible with parallel tasks._";
}
