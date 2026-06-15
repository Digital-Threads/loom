// Classify a unified-diff line for colored rendering. Pure (unit-tested); the
// DiffView component maps the kind to a CSS class.

export type DiffKind = "add" | "del" | "hunk" | "meta" | "ctx";

export function diffLineKind(line: string): DiffKind {
  if (line.startsWith("@@")) return "hunk";
  if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode|Binary )/.test(line)) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}
