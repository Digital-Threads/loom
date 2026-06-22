import { useEffect, useState } from "react";
import type { LoomClient, TokensReport } from "../api";
import { StateView } from "./StateView";
import { savedUsdLabel, formatUsd } from "../ui";
import { savedTokensToUsd } from "../pricing";
import { useT } from "../i18n";

// token-pilot usage, attributed to who ran it: per-subscription rollup + per-session
// breakdown labeled by task. "used" = tokens token-pilot consumed; "saved ≈" = its
// estimate of tokens avoided by smart reading.
export function Tokens({ client }: { client: LoomClient }) {
  const t = useT();
  const [rep, setRep] = useState<TokensReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    client.tokensReport().then(setRep).catch((e) => setErr(String(e)));
  }, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!rep) return <StateView kind="loading" />;
  if (rep.bySession.length === 0) return <StateView kind="empty" msg={t("tokens.empty")} />;

  const pct = (used: number, saved: number) => (used + saved > 0 ? Math.round((saved / (used + saved)) * 100) : 0);
  const profileLabel = (p: string) => p || t("tokens.notViaAimux");
  const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

  return (
    <div className="panel">
      <div className="stat-row">
        <div className="stat"><div className="grp">{t("tokens.tokensUsed")}</div><div className="big">{rep.totals.used.toLocaleString()}</div></div>
        <div className="stat">
          <div className="grp">{t("tokens.savedByTokenPilot")}</div>
          <div className="big">{rep.totals.saved.toLocaleString()} {rep.totals.saved > 0 ? <span className="stat-sub" title={t("tokens.savedDollarTitle")}>≈{pct(rep.totals.used, rep.totals.saved)}% · {savedUsdLabel(rep.totals.saved)} ≈</span> : null}</div>
        </div>
        <div className="stat"><div className="grp">{t("tokens.sessions")}</div><div className="big">{rep.bySession.length}</div></div>
      </div>

      <h2 style={{ marginTop: 24 }}>{t("tokens.bySubscription")}</h2>
      <table className="tbl">
        <thead><tr><th>{t("tokens.col.subscription")}</th><th className="num">{t("tokens.col.used")}</th><th className="num">{t("tokens.col.saved")}</th><th className="num">{t("tokens.col.savedPct")}</th><th className="num">{t("tokens.col.dollarSaved")}</th></tr></thead>
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

      <h2 style={{ marginTop: 24 }}>{t("tokens.bySession")}</h2>
      <table className="tbl">
        <thead><tr><th>{t("tokens.col.session")}</th><th>{t("tokens.col.subscription")}</th><th className="num">{t("tokens.col.used")}</th><th className="num">{t("tokens.col.saved")}</th><th className="num">{t("tokens.col.savedPct")}</th><th className="num">{t("tokens.col.dollarSaved")}</th></tr></thead>
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
