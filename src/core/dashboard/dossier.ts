// L3 — the task History dossier. The journal pack (task-journal's reasoning
// chain) tells WHY; the pipeline's own rows tell WHAT happened — stages run,
// tokens spent, artifacts produced. renderDossier weaves them into one Markdown
// document so the History modal reads as the task's full story. It is pure:
// the endpoint passes the pack + db rows, this only formats. Empty sections are
// omitted so a fresh task's dossier stays just its journal pack.
import type { StageRow } from "../store/db.js";
import type { CostRow } from "../store/execute.js";
import type { AttachmentRow } from "../store/attachments.js";

export interface DossierInput {
  pack: string;
  stages: StageRow[];
  costs: CostRow[];
  attachments: AttachmentRow[];
}

export function renderDossier({ pack, stages, costs, attachments }: DossierInput): string {
  const sections: string[] = [];

  if (stages.length) {
    const rows = stages.map((s) => {
      const when = s.finished_at ? ` — finished ${iso(s.finished_at)}` : s.started_at ? ` — started ${iso(s.started_at)}` : "";
      return `- **${s.stage_key}** — ${s.status}${when}`;
    });
    sections.push(`## Stages\n\n${rows.join("\n")}`);
  }

  if (costs.length) {
    // Sum each metric across sources (claude + token-pilot etc.); flag a metric
    // as estimated if any contributing row was non-exact.
    const byMetric = new Map<string, { value: number; exact: boolean }>();
    for (const c of costs) {
      const prev = byMetric.get(c.metric) ?? { value: 0, exact: true };
      byMetric.set(c.metric, { value: prev.value + c.value, exact: prev.exact && c.exact === 1 });
    }
    const rows = [...byMetric.entries()].map(
      ([metric, { value, exact }]) => `- **${metric}**: ${value}${exact ? "" : " (est.)"}`,
    );
    sections.push(`## Cost\n\n${rows.join("\n")}`);
  }

  if (attachments.length) {
    const rows = attachments.map((a) => `- ${a.kind}: **${a.name}** (${a.path_or_url})`);
    sections.push(`## Artifacts\n\n${rows.join("\n")}`);
  }

  return sections.length ? `${pack}\n\n${sections.join("\n\n")}` : pack;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
