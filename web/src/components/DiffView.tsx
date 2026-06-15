import { diffLineKind } from "../diff";

// Render a unified diff with color: additions green, deletions red, hunk headers
// highlighted, file headers muted.
export function DiffView({ text }: { text: string }) {
  if (!text.trim()) return <div className="muted">No changes.</div>;
  return (
    <pre className="diff">
      {text.split("\n").map((l, i) => (
        <div key={i} className={`dl ${diffLineKind(l)}`}>{l || " "}</div>
      ))}
    </pre>
  );
}
