import { useEffect, useState } from "react";
import type { LoomClient, AttentionItem } from "../api";

const NAV = [
  { key: "board", label: "Board", icon: "▦" },
  { key: "projects", label: "Projects", icon: "◰" },
  { key: "accounts", label: "Accounts", icon: "◷", group: "Modules" },
  { key: "tokens", label: "Tokens", icon: "❋" },
  { key: "memory", label: "Memory", icon: "✎" },
  { key: "connectors", label: "Connectors", icon: "⇄", group: "Connections" },
  { key: "knowledge", label: "Knowledge", icon: "❖", group: "Capabilities" },
  { key: "skills", label: "Skills", icon: "✦" },
  { key: "layers", label: "Layers", icon: "▤" },
  { key: "timeline", label: "Timeline", icon: "≡", group: "More" },
  { key: "settings", label: "Settings", icon: "⚙" },
] as const;

export function Sidebar({
  client,
  view,
  onNav,
  open,
}: {
  client: LoomClient;
  view: string;
  onNav: (v: string) => void;
  open: boolean;
}) {
  const [attn, setAttn] = useState<AttentionItem[]>([]);
  useEffect(() => {
    client.attention().then(setAttn).catch(() => setAttn([]));
  }, [client, view]);

  return (
    <aside className={`side ${open ? "open" : ""}`}>
      <div className="brand">
        <span className="dot" /> Loom
      </div>
      <nav className="nav">
        {NAV.map((n) => (
          <div key={n.key}>
            {"group" in n && n.group ? <div className="grp">{n.group}</div> : null}
            <button className={view === n.key ? "active" : ""} onClick={() => onNav(n.key)}>
              <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span> {n.label}
            </button>
          </div>
        ))}
      </nav>
      <div className="spacer" />
      <div className="attn" onClick={() => onNav("board")}>
        <div className="h">
          🔔 Needs attention {attn.length > 0 ? <span className="badge">{attn.length}</span> : null}
        </div>
        <div className="b">
          {attn.length ? attn.map((a) => `${a.taskId}: ${a.stageKey}`).join(" · ") : "empty"}
        </div>
      </div>
    </aside>
  );
}
