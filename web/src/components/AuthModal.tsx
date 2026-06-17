import { useEffect, useRef, useState } from "react";
import type { LoomClient, AuthView } from "../api";
import { Modal } from "./Modal";
import { toast } from "../toast";

// In-UI authorization for a profile: start `aimux auth login <name>` on the
// server, show the OAuth link, take the pasted code, report success. No terminal.
export function AuthModal({
  client,
  profile,
  onClose,
  onDone,
}: {
  client: LoomClient;
  profile: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [authId, setAuthId] = useState<string | null>(null);
  const [view, setView] = useState<AuthView>({ status: "starting", authorized: false });
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const startedRef = useRef(false);

  // Start once; then poll status until done/error.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    client.authStart(profile)
      .then(setAuthId)
      .catch((e) => { setView({ status: "error", authorized: false, error: String(e) }); });
  }, [client, profile]);

  useEffect(() => {
    if (!authId) return;
    let alive = true;
    const poll = () => client.authStatus(authId).then((v) => {
      if (!alive) return;
      setView(v);
      if (v.status === "done") { toast.success(`Authorized: ${profile}`); onDone(); }
    }).catch(() => {});
    poll();
    const iv = setInterval(() => { if (view.status !== "done" && view.status !== "error") poll(); }, 1500);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authId]);

  async function submit() {
    if (!authId || !code.trim()) return;
    setSending(true);
    try { await client.authCode(authId, code.trim()); setCode(""); }
    catch (e) { toast.error(`Couldn’t submit code: ${e}`); }
    finally { setSending(false); }
  }

  return (
    <Modal title={`Authorize "${profile}"`} onClose={onClose}>
        <div className="modal-b">
          {view.status === "starting" ? (
            <div className="state-loading"><span className="spin" />Starting authorization…</div>
          ) : view.status === "error" ? (
            <div className="state-err">⚠ {view.error ?? "Authorization failed"}</div>
          ) : view.status === "done" ? (
            <div className="ready-note"><div><span className="ok-dot">✓</span> Authorized — credentials saved.</div></div>
          ) : (
            <>
              <ol style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
                <li>Open the sign-in link and log into the account for <b>{profile}</b>.</li>
                <li>Copy the code shown after login and paste it below.</li>
              </ol>
              {view.url ? (
                <a className="btn acc" href={view.url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginBottom: 12, textDecoration: "none" }}>
                  ↗ Open sign-in link
                </a>
              ) : null}
              <label className="fld">
                <span>Authorization code</span>
                <div className="fld-row" style={{ gap: 8 }}>
                  <input value={code} placeholder="paste code here" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} style={{ flex: 1 }} />
                  <button className="btn acc" disabled={sending || !code.trim()} onClick={submit}>{sending ? "…" : "Submit"}</button>
                </div>
              </label>
            </>
          )}
        </div>
        <div className="modal-f">
          <button className="btn" onClick={onClose}>{view.status === "done" ? "Close" : "Cancel"}</button>
        </div>
    </Modal>
  );
}
