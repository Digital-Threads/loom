// Extract file-path-like tokens from agent text so the UI can offer to open them
// in the viewer. Conservative: requires at least one "/" and a file extension,
// which avoids matching prose like "e.g." while catching "src/web/api.ts" and
// ".docs/plans/2026-06-15-foo.md".

const PATH_RE = /(?:[\w.@-]+\/)+[\w.@-]+\.[a-zA-Z0-9]{1,8}/g;

export function filePaths(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.match(PATH_RE) ?? []) {
    const clean = m.replace(/[.,:;)\]]+$/, ""); // trailing punctuation from prose
    if (clean.includes("/")) seen.add(clean);
  }
  return [...seen];
}
