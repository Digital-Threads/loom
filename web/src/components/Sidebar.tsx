import { useEffect, useRef, useState } from "react";
import type { LoomClient, AttentionItem } from "../api";
import { NAV } from "../nav";
import { useT } from "../i18n";
import loomMark from "../assets/loom-mark.svg";

// Group header ("Modules" etc.) → i18n key. Falls back to the raw label.
const GROUP_KEYS: Record<string, string> = {
  Modules: "nav.group.modules",
  Connections: "nav.group.connections",
  Capabilities: "nav.group.capabilities",
  More: "nav.group.more",
};

export function Sidebar({
  client,
  view,
  onNav,
  onOpenTask,
  open,
}: {
  client: LoomClient;
  view: string;
  onNav: (v: string) => void;
  onOpenTask: (id: string) => void;
  open: boolean;
}) {
  const [attn, setAttn] = useState<AttentionItem[]>([]);
  const seen = useRef(0); // last count we notified about — avoids re-firing
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        // Read notify.enabled fresh each cycle so toggling it in Settings takes
        // effect immediately. Default on; off only when explicitly set.
        const notifyOn = await client.settings().then((s) => s["notify.enabled"] !== false).catch(() => true);
        const items = await client.attention();
        if (cancelled) return;
        // D6.4 — browser push when MORE tasks need attention than we last saw.
        if (notifyOn && typeof Notification !== "undefined" && items.length > seen.current) {
          if (Notification.permission === "granted") {
            new Notification("Loom — needs attention", { body: `${items.length} task(s) awaiting you` });
          } else if (Notification.permission === "default") {
            Notification.requestPermission().catch(() => {});
          }
        }
        seen.current = items.length;
        setAttn(items);
      } catch {
        if (!cancelled) setAttn([]);
      }
    }
    poll();
    // Keep the queue fresh without a page reload — a task can hit a gate or crash
    // while you sit on any screen.
    const timer = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [client, view]);

  return (
    <aside className={`side ${open ? "open" : ""}`}>
      <div className="brand">
        <img className="brand-mark" src={loomMark} alt="" aria-hidden="true" /> Loom
        <span className="beta-tag">beta</span>
      </div>
      <nav className="nav">
        {NAV.map((n) => (
          <div key={n.key}>
            {"group" in n && n.group ? <div className="grp">{t(GROUP_KEYS[n.group] ?? n.group)}</div> : null}
            <button
              className={view === n.key ? "active" : ""}
              aria-current={view === n.key ? "page" : undefined}
              onClick={() => onNav(n.key)}
            >
              <span className="nav-ico" aria-hidden="true">{n.icon}</span> {t(`nav.${n.key}`)}
            </button>
          </div>
        ))}
      </nav>
      <div className="spacer" />
      <div className="attn">
        <div className="h">
          <span aria-hidden="true">🔔</span> {t("nav.attention")}
          {attn.length > 0 ? <span className="badge">{attn.length}</span> : null}
        </div>
        {attn.length ? (
          <div className="attn-list">
            {attn.map((a) => (
              <button
                type="button"
                className="attn-item"
                key={a.taskId}
                onClick={() => onOpenTask(a.taskId)}
                title={`${a.title} — ${a.stageKey} (click to open)`}
              >
                <span className="attn-title">{a.title || a.taskId}</span>
                <span className="attn-stage">{a.stageKey}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="b">Nothing waiting on you.</div>
        )}
      </div>
    </aside>
  );
}
