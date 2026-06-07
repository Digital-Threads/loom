import type { PackInput } from "./pack-input.js";

const UNAVAILABLE = (why: string) => `_недоступно: ${why}_`;

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
function sectionProfile(_input: PackInput): string { return `## Active profile\n\n${UNAVAILABLE("заполняется в следующей задаче")}`; }
function sectionTask(_input: PackInput): string { return `## Active task\n\n${UNAVAILABLE("заполняется в следующей задаче")}`; }
function sectionDecisions(_input: PackInput): string { return `## Recent decisions\n\n${UNAVAILABLE("заполняется в следующей задаче")}`; }
function sectionRejections(_input: PackInput): string { return `## Rejected approaches\n\n${UNAVAILABLE("заполняется в следующей задаче")}`; }
function sectionTouchedFiles(_input: PackInput): string { return `## Touched files\n\n${UNAVAILABLE("ни один слой не отдаёт список файлов")}`; }
function sectionTokenUsage(_input: PackInput): string { return `## Token usage\n\n${UNAVAILABLE("заполняется в следующей задаче")}`; }
function sectionWorkflowBudget(_input: PackInput): string { return `## Workflow budget\n\n${UNAVAILABLE("нет источника бюджета workflow")}`; }
function sectionMcpHealth(_input: PackInput): string { return `## MCP / environment health\n\n${UNAVAILABLE("заполняется в следующей задаче")}`; }
function sectionFooter(_input: PackInput): string {
  return "---\n_Токены на задачу — оценка по временно́му окну событий задачи (LP4); возможен double-count при параллельных задачах._";
}
