import { useEffect, useState } from "react";
import type { LoomClient, LayerInfo } from "../api";
import { StateView } from "./StateView";

// L11.2 — Layers: registered plugins by category, capability badges.
export function Layers({ client }: { client: LoomClient }) {
  const [layers, setLayers] = useState<LayerInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { client.layers().then(setLayers).catch((e) => setErr(String(e))); }, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!layers) return <StateView kind="loading" />;

  return (
    <div className="panel">
      <table className="tbl">
        <thead><tr><th>Layer</th><th>Category</th><th>Capabilities</th></tr></thead>
        <tbody>
          {layers.map((l) => (
            <tr key={l.id}>
              <td>{l.title}{l.id !== l.title ? <span className="crumb" style={{ marginLeft: 8 }}>{l.id}</span> : null}</td>
              <td>{l.category ?? "—"}</td>
              <td>
                {l.executes ? <span className="chip ok" style={{ marginRight: 6 }}>execute</span> : null}
                {l.slots.length ? <span className="chip">{l.slots.length} slot(s)</span> : null}
                {!l.executes && l.slots.length === 0 ? <span className="muted">display</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
