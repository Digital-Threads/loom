import { useEffect, useState } from "react";
import { Modal } from "./Modal";

// Shown when the task's current subscription is near its rate limit. Lets the
// user switch to another account (the conversation resumes under it); if they
// don't choose within the countdown, it auto-switches to the first candidate.
export function LimitModal({
  profile,
  pct,
  profiles,
  onSwitch,
  onDismiss,
}: {
  profile: string;
  pct: number;
  profiles: string[]; // candidates (current profile already excluded)
  onSwitch: (p: string) => void;
  onDismiss: () => void;
}) {
  const fallback = profiles[0] ?? "";
  const [pick, setPick] = useState(fallback);
  const [left, setLeft] = useState(30);

  useEffect(() => {
    if (!fallback) return; // nothing to auto-switch to — wait for the user
    if (left <= 0) {
      onSwitch(pick || fallback);
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, fallback]);

  return (
    <Modal title="⚠ Subscription nearly out" headStyle={{ color: "var(--warn)" }}>
        <div className="modal-b">
          <p style={{ margin: "0 0 12px" }}>
            <b>{profile}</b> is at <b>{pct}%</b> of its 5-hour limit. Switch this task to another
            subscription to keep it running — the conversation continues via resume.
          </p>
          {profiles.length ? (
            <label className="fld">
              <span>Switch to</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="muted">No other subscription available — add one in Accounts.</div>
          )}
          {fallback ? (
            <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 10 }}>
              Auto-switching to <b>{pick || fallback}</b> in {left}s…
            </div>
          ) : null}
        </div>
        <div className="modal-f">
          <button className="btn" onClick={onDismiss}>Stay on {profile}</button>
          <button className="btn acc" disabled={!pick} onClick={() => onSwitch(pick)}>Switch now</button>
        </div>
    </Modal>
  );
}
