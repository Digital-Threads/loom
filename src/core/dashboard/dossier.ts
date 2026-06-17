// L3 — the task History dossier. The journal pack (task-journal's reasoning
// chain) tells WHY; the pipeline's own rows tell WHAT happened — stages run,
// tokens spent, artifacts produced. renderDossier weaves them into one Markdown
// document so the History modal reads as the task's full story. It is pure:
// the endpoint passes the pack + db rows, this only formats. Empty sections are
// omitted so a fresh task's dossier stays just its journal pack.
import type { StageRow } from "../store/db.js";
import type { CostRow } from "../store/execute.js";
import type { AttachmentRow } from "../store/attachments.js";
import type { Sh } from "../pipeline/pr-done.js";

export interface DossierInput {
  pack: string;
  stages: StageRow[];
  costs: CostRow[];
  attachments: AttachmentRow[];
  /** Pre-computed `git diff --stat` summary for the task's branch (from
   *  diffSummary); a Changes section is appended when non-empty. */
  diff?: string;
}

export function renderDossier({ pack, stages, costs, attachments, diff }: DossierInput): string {
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

  if (diff && diff.trim()) {
    // Fence the --stat so the modal renders it monospace, columns aligned.
    sections.push(`## Changes\n\n\`\`\`\n${diff.trim()}\n\`\`\``);
  }

  return sections.length ? `${pack}\n\n${sections.join("\n\n")}` : pack;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Best-effort `git diff --stat base...branch` for the task's worktree branch.
 *  Returns the trimmed summary, or "" when the branch is missing / nothing
 *  changed / git is unavailable — the endpoint then just omits the section. The
 *  injected sh never rejects, so this is safe to await on the request path. */
export async function diffSummary(sh: Sh, repoRoot: string, base: string, branch: string): Promise<string> {
  const r = await sh("git", ["diff", "--stat", `${base}...${branch}`], repoRoot);
  return r.code === 0 ? r.stdout.trim() : "";
}
