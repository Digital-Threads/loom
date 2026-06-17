import { useEffect, useState } from "react";
import type { LoomClient, AttentionItem } from "../api";
import loomMark from "../assets/loom-mark.svg";

const NAV = [
  { key: "board", label: "Board", icon: "▦" },
  { key: "projects", label: "Projects", icon: "◰" },
  { key: "accounts", label: "Accounts", icon: "◷", group: "Modules" },
  { key: "tokens", label: "Tokens", icon: "❋" },
  { key: "memory", label: "Memory", icon: "✎" },
  { key: "security", label: "Security", icon: "🛡" },
  { key: "quality", label: "Quality", icon: "✓" },
  { key: "swarm", label: "Swarm", icon: "⚇" },
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
  const [notifyOn, setNotifyOn] = useState(true);
  // Honour the Settings "Notifications" toggle (loom-wkhe): default on, off when
  // the user disabled it.
  useEffect(() => { client.settings().then((s) => setNotifyOn(s["notify.enabled"] !== false)).catch(() => {}); }, [client]);
  useEffect(() => {
    client.attention().then((items) => {
      // D6.4 — browser push when new items need attention (unless disabled).
      if (notifyOn && typeof Notification !== "undefined" && items.length > attn.length) {
        if (Notification.permission === "granted") {
          new Notification("Loom — needs attention", { body: `${items.length} task(s) awaiting you` });
        } else if (Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      }
      setAttn(items);
    }).catch(() => setAttn([]));
  }, [client, view]);

  return (
    <aside className={`side ${open ? "open" : ""}`}>
      <div className="brand">
        <img className="brand-mark" src={loomMark} alt="" aria-hidden="true" /> Loom
      </div>
      <nav className="nav">
        {NAV.map((n) => (
          <div key={n.key}>
            {"group" in n && n.group ? <div className="grp">{n.group}</div> : null}
            <button
              className={view === n.key ? "active" : ""}
              aria-current={view === n.key ? "page" : undefined}
              onClick={() => onNav(n.key)}
            >
              <span style={{ width: 16, textAlign: "center" }} aria-hidden="true">{n.icon}</span> {n.label}
            </button>
          </div>
        ))}
      </nav>
      <div className="spacer" />
      <button type="button" className="attn" onClick={() => onNav("board")}>
        <div className="h">
          <span aria-hidden="true">🔔</span> Needs attention {attn.length > 0 ? <span className="badge">{attn.length}</span> : null}
        </div>
        <div className="b">
          {attn.length ? attn.map((a) => `${a.taskId}: ${a.stageKey}`).join(" · ") : "empty"}
        </div>
      </button>
    </aside>
  );
}
