import { useEffect, useState } from "react";
import type { LoomClient, TokensReport } from "../api";
import { StateView } from "./StateView";
import { savedUsdLabel, formatUsd } from "../ui";
import { savedTokensToUsd } from "../pricing";

// token-pilot usage, attributed to who ran it: per-subscription rollup + per-session
// breakdown labeled by task. "used" = tokens token-pilot consumed; "saved ≈" = its
// estimate of tokens avoided by smart reading.
export function Tokens({ client }: { client: LoomClient }) {
  const [rep, setRep] = useState<TokensReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    client.tokensReport().then(setRep).catch((e) => setErr(String(e)));
  }, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!rep) return <StateView kind="loading" />;
  if (rep.bySession.length === 0) return <StateView kind="empty" msg="No token usage recorded yet." />;

  const pct = (used: number, saved: number) => (used + saved > 0 ? Math.round((saved / (used + saved)) * 100) : 0);
  const profileLabel = (p: string) => p || "(not via aimux)";
  const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

  return (
    <div className="panel">
      <div className="stat-row">
        <div className="stat"><div className="grp">Tokens used</div><div className="big">{rep.totals.used.toLocaleString()}</div></div>
        <div className="stat">
          <div className="grp">Saved by token-pilot</div>
          <div className="big">{rep.totals.saved.toLocaleString()} {rep.totals.saved > 0 ? <span className="stat-sub" title="Estimated $ value of the saved tokens, priced at the default model's input rate">≈{pct(rep.totals.used, rep.totals.saved)}% · {savedUsdLabel(rep.totals.saved)} ≈</span> : null}</div>
        </div>
        <div className="stat"><div className="grp">Sessions</div><div className="big">{rep.bySession.length}</div></div>
      </div>

      <h2 style={{ marginTop: 24 }}>By subscription</h2>
      <table className="tbl">
        <thead><tr><th>Subscription</th><th className="num">Used</th><th className="num">Saved ≈</th><th className="num">Saved %</th><th className="num">$ saved ≈</th></tr></thead>
        <tbody>
          {rep.byProfile.map((p) => (
            <tr key={p.profile || "(none)"}>
              <td>{p.profile ? profileLabel(p.profile) : <span className="muted">{profileLabel(p.profile)}</span>}</td>
              <td className="num">{p.used.toLocaleString()}</td>
              <td className="num">{p.saved.toLocaleString()}</td>
              <td className="num">{p.used + p.saved > 0 ? `${pct(p.used, p.saved)}%` : "—"}</td>
              <td className="num">{p.saved > 0 ? formatUsd(savedTokensToUsd(p.saved)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>By session</h2>
      <table className="tbl">
        <thead><tr><th>Session</th><th>Subscription</th><th className="num">Used</th><th className="num">Saved ≈</th><th className="num">Saved %</th><th className="num">$ saved ≈</th></tr></thead>
        <tbody>
          {rep.bySession.map((s) => (
            <tr key={s.sessionId}>
              <td title={s.sessionId}>
                {s.taskTitle ?? <span className="crumb">{shortId(s.sessionId)}</span>}
              </td>
              <td className="crumb">{s.profile ? profileLabel(s.profile) : <span className="muted">{profileLabel(s.profile)}</span>}</td>
              <td className="num">{s.used.toLocaleString()}</td>
              <td className="num">{s.saved.toLocaleString()}</td>
              <td className="num">{s.used + s.saved > 0 ? `${pct(s.used, s.saved)}%` : "—"}</td>
              <td className="num">{s.saved > 0 ? formatUsd(savedTokensToUsd(s.saved)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
