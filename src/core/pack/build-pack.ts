import type { PackInput } from "./pack-input.js";
import { taskDetailFromEvents } from "../plugins/task-journal/adapter.js";
import { tokensForTask } from "../metrics/tokens-per-task.js";
import { tokenTotals } from "../views/derivations.js";

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
function sectionTokenUsage(input: PackInput): string {
  if (input.data.tokens.length === 0)
    return `## Token usage\n\n${UNAVAILABLE("нет данных о токенах")}`;
  const total = tokenTotals(input.data);
  const lines = [`Project total: потрачено ${total.used} · сэкономлено ${total.saved}`];
  const r = resolveActiveTaskId(input);
  if (r) {
    const t = tokensForTask(input.data.taskEvents, r.id, input.data.tokenEvents);
    lines.push(`Active task: потрачено ${t.used} · сэкономлено ${t.saved} (оценка по времени)`);
  }
  return "## Token usage\n\n" + lines.join("\n");
}
function sectionWorkflowBudget(_input: PackInput): string { return `## Workflow budget\n\n${UNAVAILABLE("нет источника бюджета workflow")}`; }
function sectionMcpHealth(input: PackInput): string {
  const lines: string[] = [];
  for (const h of input.data.health) {
    const bad = h.broken.length + h.missing.length + h.conflicts.length;
    lines.push(bad === 0 ? `- ${h.profile}: ok`
      : `- ${h.profile}: проблемы — broken ${h.broken.length}, missing ${h.missing.length}, conflicts ${h.conflicts.length}`);
  }
  if (input.data.errors.length) {
    lines.push("", "Ошибки загрузки слоёв:");
    for (const e of input.data.errors) lines.push(`- ${e}`);
  }
  const body = lines.length ? lines.join("\n") : "все слои отдали данные без ошибок";
  return "## MCP / environment health\n\n" + body;
}
function sectionFooter(_input: PackInput): string {
  return "---\n_Токены на задачу — оценка по временно́му окну событий задачи (LP4); возможен double-count при параллельных задачах._";
}
