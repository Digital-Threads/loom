import { summarizeCosts, type CostRowLike } from "../ui";

// The task's running cost, read at a glance: real spend up front, then the
// token usage with how much token-pilot saved. Unknown rows fall through as-is
// so nothing the recorder writes is silently dropped. "≈" marks estimates.
export function CostBar({ costs }: { costs: CostRowLike[] }) {
  const s = summarizeCosts(costs);
  return (
    <div className="cost-bar">
      <span className="cost-label">Cost</span>
      {s.empty ? (
        <span className="muted">—</span>
      ) : (
        <>
          {s.spend ? (
            <span className="cost-spend" title="Real spend for this task">
              <b>{s.spend}</b>
              {s.spendEstimate ? <span className="cost-approx"> ≈</span> : null}
            </span>
          ) : null}
          {/* token-pilot READ savings — how many tokens of file content it avoided
              loading (summed across the task's model sessions), NOT the agent's
              billed tokens and NOT a reduction of the spend above. Labelled so it
              can't be read as the task's token usage. */}
          {s.tokens && s.tokens.savedPct > 0 ? (
            <span
              className="cost-tokens cost-saved"
              title="token-pilot saved this many tokens of file reads vs. naive reads, summed across the task's model sessions. It's read efficiency — separate from the $ spent above."
            >
              token-pilot saved <b>{s.tokens.saved}</b> read-tokens ({s.tokens.savedPct}%)
              {s.tokens.savedUsd ? (
                <span className="cost-approx" title="Estimated value of the avoided reads (saved tokens × input price) — not a reduction of the spend above"> ≈ {s.tokens.savedUsd}</span>
              ) : null}
            </span>
          ) : null}
          {s.other.map((o, i) => (
            <span className="cost-stat" key={i}>
              <b>{o.value}{o.estimate ? " ≈" : ""}</b> {o.label}
            </span>
          ))}
        </>
      )}
    </div>
  );
}
