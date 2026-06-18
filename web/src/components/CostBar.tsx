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
          {s.tokens && s.tokens.used !== "0" ? (
            <span className="cost-tokens" title="Tokens used by the agent for this task">
              <b>{s.tokens.used}</b> tokens
              {s.tokensEstimate ? <span className="cost-approx"> ≈</span> : null}
              {s.tokens.savedPct > 0 ? (
                <span className="cost-saved">
                  {" · "}{s.tokens.saved} saved ({s.tokens.savedPct}%)
                  {s.tokens.savedUsd ? <span className="cost-approx" title="Estimated $ saved by token-pilot (saved tokens × input price)"> · {s.tokens.savedUsd} ≈</span> : null}
                </span>
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
