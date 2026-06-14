import { useEffect, useState } from "react";
import type { LoomClient, SkillSlot } from "../api";
import { STAGE_LABELS } from "../api";

// L11.3 — Skills: which skill backs which pipeline stage slot.
export function Skills({ client }: { client: LoomClient }) {
  const [slots, setSlots] = useState<SkillSlot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { client.skills().then(setSlots).catch((e) => setErr(String(e))); }, [client]);

  if (err) return <div className="empty">Can’t reach the core: {err}</div>;
  if (!slots) return <div className="empty">Loading…</div>;
  if (slots.length === 0) return <div className="empty">No skill slots contributed yet — layers register them via the contract.</div>;

  return (
    <div className="panel">
      <table className="tbl">
        <thead><tr><th>Stage</th><th>Skill</th><th>Plugin</th></tr></thead>
        <tbody>
          {slots.map((s, i) => (
            <tr key={i}><td>{STAGE_LABELS[s.stage] ?? s.stage}</td><td>{s.skill}</td><td className="crumb">{s.plugin}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
