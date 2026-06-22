import { useEffect, useState } from "react";
import type { LoomClient } from "../api";

// Polished in-app approval panel (no native prompts). In manual/gated mode the
// agent's non-allowlisted tool attempts are denied and shown here; Approve adds
// the tool to the task's allowlist so the next run can use it.
export function Approvals({ client, taskId, onChanged, running }: { client: LoomClient; taskId: string; onChanged?: () => void; running?: boolean }) {
  const [denials, setDenials] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  // Fetch denials, hiding ones the user already dismissed this view (so a poll
  // doesn't resurrect them). Approved tools drop off server-side on the next read.
  function refresh() {
    client.permissions(taskId).then((p) => setDenials(p.denials.filter((t) => !dismissed.has(t)))).catch(() => {});
  }
  // Poll while the task is running so denials raised mid-run surface promptly,
  // not only when the task view is reopened. Idle → fetch once.
  useEffect(() => {
    refresh();
    if (!running) return;
    const h = setInterval(refresh, 4000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, taskId, running, dismissed]);

  async function approve(tool: string) {
    setBusy(tool);
    try {
      await client.permissionAllow(taskId, tool);
      setDenials((d) => d.filter((t) => t !== tool));
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }
  function dismiss(tool: string) {
    setDismissed((s) => new Set(s).add(tool));
    setDenials((d) => d.filter((t) => t !== tool));
  }

  if (denials.length === 0) return null;

  return (
    <div className="approvals">
      <div className="approvals-h">
        <span className="approvals-dot" />
        Agent needs approval ({denials.length})
      </div>
      <div className="approvals-sub">
        These actions were blocked in this run. Approve to allow them on the next run.
      </div>
      <div className="approvals-list">
        {denials.map((tool) => (
          <div className="approvals-row" key={tool}>
            <code className="approvals-tool">{tool}</code>
            <div className="approvals-actions">
              <button className="btn" disabled={busy === tool} title="Hide this request; the tool stays disallowed until you approve it" onClick={() => dismiss(tool)}>Dismiss</button>
              <button className="btn acc" disabled={busy === tool} onClick={() => approve(tool)}>
                {busy === tool ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
