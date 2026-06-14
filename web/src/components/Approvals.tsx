import { useEffect, useState } from "react";
import type { LoomClient } from "../api";

// Polished in-app approval panel (no native prompts). In manual/gated mode the
// agent's non-allowlisted tool attempts are denied and shown here; Approve adds
// the tool to the task's allowlist so the next run can use it.
export function Approvals({ client, taskId, onChanged }: { client: LoomClient; taskId: string; onChanged?: () => void }) {
  const [denials, setDenials] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    client.permissions(taskId).then((p) => setDenials(p.denials)).catch(() => {});
  }
  useEffect(refresh, [client, taskId]);

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
              <button className="btn" disabled={busy === tool} onClick={() => dismiss(tool)}>Deny</button>
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
