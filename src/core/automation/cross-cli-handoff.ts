// Cross-CLI provider switch (loom-yzmk). Switching a task to a profile on the
// SAME CLI (e.g. another Claude account, or an Anthropic-compatible preset) keeps
// the session via native --resume. But a profile on a DIFFERENT CLI (Codex, …)
// can't resume a Claude session — the session formats differ. So we hand off: a
// FRESH session under the new CLI, seeded with a compact summary of the task's
// own context (spec + analysis + spec artifact + the last message), wrapped in
// aimux's handoff prompt. Pure helpers here; the endpoint wires the session.

/** True when the two profiles run different CLIs, so a native resume is
 *  impossible and a context handoff is needed. Same CLI (or no source) → false. */
export function isCrossCli(fromCli: string | undefined | null, toCli: string | undefined | null): boolean {
  return !!fromCli && !!toCli && fromCli !== toCli;
}

export interface HandoffContext {
  spec: string;
  analysis?: string;
  specMd?: string;
  lastMessage?: string;
}

/** Build the compact handoff seed from the task's OWN data (not the raw CLI
 *  transcript): the spec and the accepted analysis/spec artifacts plus the last
 *  message carry the meaningful state, and are available without a live call to
 *  either provider. Each section is trimmed to a budget so the seed stays light. */
export function buildHandoffSeed(ctx: HandoffContext, maxSectionChars = 2000): string {
  const trim = (s: string) => (s.length > maxSectionChars ? `${s.slice(0, maxSectionChars)}\n…(trimmed)` : s);
  const sections: Array<[string, string | undefined]> = [
    ["TASK", ctx.spec],
    ["ANALYSIS", ctx.analysis],
    ["SPEC", ctx.specMd],
    ["LAST MESSAGE", ctx.lastMessage],
  ];
  return sections
    .filter(([, v]) => v && v.trim())
    .map(([label, v]) => `${label}:\n${trim(v!.trim())}`)
    .join("\n\n");
}
