import type { PackInput } from "./pack-input.js";
import { taskDetailFromEvents } from "@digital-threads/loom-plugin-task-journal";

const UNAVAILABLE = (why: string) => `_недоступно: ${why}_`;
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
  if (sess) return `## Active profile\n\n${sess.profile} (эвристика: последняя сессия)`;
  return `## Active profile\n\n${UNAVAILABLE("нет активного профиля")}`;
}
function resolveActiveTaskId(input: PackInput): { id: string; heuristic: boolean } | null {
  if (input.config.activeTaskId) return { id: input.config.activeTaskId, heuristic: false };
  const open = input.data.tasks.find((t) => t.status === "open");
  return open ? { id: open.id, heuristic: true } : null;
}
function sectionTask(input: PackInput): string {
  const r = resolveActiveTaskId(input);
  if (!r) return `## Active task\n\n${UNAVAILABLE("нет активной задачи")}`;
  const t = input.data.tasks.find((x) => x.id === r.id);
  const title = t?.title ?? "(нет в журнале)";
  const status = t?.status ?? "?";
  const tag = r.heuristic ? " (эвристика: первая открытая)" : "";
  return `## Active task\n\n${r.id} — ${title} [${status}]${tag}`;
}
function sectionDecisions(input: PackInput): string {
  const r = resolveActiveTaskId(input);
  if (!r) return `## Recent decisions\n\n${UNAVAILABLE("нет активной задачи")}`;
  const { decisions } = taskDetailFromEvents(input.data.taskEvents, r.id);
  if (decisions.length === 0) return "## Recent decisions\n\n_нет записанных решений_";
  return "## Recent decisions\n\n" + decisions.slice(-RECENT).map((e) => `- ${e.text}`).join("\n");
}
function sectionRejections(input: PackInput): string {
  const r = resolveActiveTaskId(input);
  if (!r) return `## Rejected approaches\n\n${UNAVAILABLE("нет активной задачи")}`;
  const { rejections } = taskDetailFromEvents(input.data.taskEvents, r.id);
  if (rejections.length === 0) return "## Rejected approaches\n\n_нет отвергнутых подходов_";
  return "## Rejected approaches\n\n" + rejections.map((e) => `- ${e.text}`).join("\n");
}
function sectionTouchedFiles(_input: PackInput): string { return `## Touched files\n\n${UNAVAILABLE("ни один слой не отдаёт список файлов")}`; }
function sectionTokenUsage(_input: PackInput): string { return `## Token usage\n\n${UNAVAILABLE("заполняется в следующей задаче")}`; }
function sectionWorkflowBudget(_input: PackInput): string { return `## Workflow budget\n\n${UNAVAILABLE("нет источника бюджета workflow")}`; }
function sectionMcpHealth(_input: PackInput): string { return `## MCP / environment health\n\n${UNAVAILABLE("заполняется в следующей задаче")}`; }
function sectionFooter(_input: PackInput): string {
  return "---\n_Токены на задачу — оценка по временно́му окну событий задачи (LP4); возможен double-count при параллельных задачах._";
}
