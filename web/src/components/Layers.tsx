import { useEffect, useState } from "react";
import type { LoomClient, LayerInfo } from "../api";
import { StateView } from "./StateView";

// L11.2 — Layers: the full Loom architecture. 3 layers are already standalone
// plugins (aimux / token-pilot / task-journal); the rest are inline in core/*
// and become standalone packages in Phase 2. Shows every layer + its status.
export function Layers({ client }: { client: LoomClient }) {
  const [layers, setLayers] = useState<LayerInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { client.layers().then(setLayers).catch((e) => setErr(String(e))); }, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!layers) return <StateView kind="loading" />;

  const standalone = layers.filter((l) => l.status === "standalone");
  const inline = layers.filter((l) => l.status === "inline");

  return (
    <div className="panel">
      <Group title="Standalone-плагины" hint="вынесены в отдельные пакеты (Фаза 1)" layers={standalone} />
      <Group title="Inline-слои" hint="живут в core/* — станут standalone-плагинами в Фазе 2" layers={inline} />
    </div>
  );
}

function Group({ title, hint, layers }: { title: string; hint: string; layers: LayerInfo[] }) {
  if (layers.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="layer-group-h"><b>{title}</b> <span className="muted">— {hint}</span></div>
      {layers.map((l) => (
        <div key={l.id} className="layer-row">
          <div className="layer-main">
            <span className={`badge ${l.status === "standalone" ? "badge-ok" : "badge-warn"}`}>
              {l.status === "standalone" ? "✅ standalone" : "🔨 inline"}
            </span>
            <b className="layer-title">{l.title}</b>
            <span className="crumb">{l.node}</span>
            {l.executes ? <span className="chip ok">execute</span> : null}
            {l.slots.length ? <span className="chip">{l.slots.length} slot(s)</span> : null}
          </div>
          <div className="layer-desc">{l.description}</div>
          <div className="layer-src muted">{l.source}</div>
        </div>
      ))}
    </div>
  );
}
