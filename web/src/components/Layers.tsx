import { useEffect, useState } from "react";
import type { LoomClient, LayerInfo } from "../api";
import { layerSection } from "../layers";
import { StateView } from "./StateView";
import { useT } from "../i18n";

// L11.2 — Layers: the full Loom architecture. 3 layers are already standalone
// plugins (aimux / token-pilot / task-journal); the rest are inline in core/*
// and become standalone packages in Phase 2. Shows every layer + its status.
// Layers that have their own menu section (see ../layers) are clickable and jump
// straight to that section.
export function Layers({ client, onNav }: { client: LoomClient; onNav: (v: string) => void }) {
  const t = useT();
  const [layers, setLayers] = useState<LayerInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { client.layers().then(setLayers).catch((e) => setErr(String(e))); }, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!layers) return <StateView kind="loading" />;

  const standalone = layers.filter((l) => l.status === "standalone");
  const inline = layers.filter((l) => l.status === "inline");

  return (
    <div className="panel">
      <Group title={t("layers.standalone.title")} hint={t("layers.standalone.hint")} layers={standalone} onNav={onNav} />
      <Group title={t("layers.inline.title")} hint={t("layers.inline.hint")} layers={inline} onNav={onNav} />
    </div>
  );
}

function Group({ title, hint, layers, onNav }: { title: string; hint: string; layers: LayerInfo[]; onNav: (v: string) => void }) {
  const t = useT();
  if (layers.length === 0) return null;
  return (
    <div className="layer-group">
      <div className="layer-group-h"><b>{title}</b> <span className="muted">— {hint}</span></div>
      {layers.map((l) => {
        const section = layerSection(l.id);
        const inner = (
          <>
            <div className="layer-main">
              <span className={`badge ${l.status === "standalone" ? "badge-ok" : "badge-warn"}`}>
                {l.status === "standalone" ? `✅ ${t("layers.badge.standalone")}` : `🔨 ${t("layers.badge.inline")}`}
              </span>
              <b className="layer-title">{l.title}</b>
              <span className="crumb">{l.node}</span>
              {l.executes ? <span className="chip ok">{t("layers.execute")}</span> : null}
              {l.slots.length ? <span className="chip">{l.slots.length} {t("layers.slots")}</span> : null}
            </div>
            <div className="layer-desc">{l.description}</div>
            <div className="layer-src muted">{l.source}</div>
          </>
        );
        return section ? (
          // role=button (not <button>) so the block-level layer-* divs stay valid
          // DOM; the global [tabindex]:focus-visible rule supplies the focus ring.
          <div
            key={l.id}
            role="button"
            tabIndex={0}
            className="layer-row layer-row-link"
            onClick={() => onNav(section)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNav(section); } }}
            title={`${t("layers.open")} ${l.title}`}
            aria-label={`${t("layers.open")} ${l.title}`}
          >
            {inner}
          </div>
        ) : (
          <div key={l.id} className="layer-row">{inner}</div>
        );
      })}
    </div>
  );
}
