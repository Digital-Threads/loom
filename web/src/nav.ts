// Sidebar navigation model — kept as pure data (no React / asset imports) so both
// the Sidebar component and tests can import the section keys without dragging in
// the browser-only bits. The Sidebar renders icons/labels/groups from this list.
export const NAV = [
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
  { key: "learning", label: "Learning", icon: "↻" },
  { key: "layers", label: "Layers", icon: "▤" },
  { key: "timeline", label: "Timeline", icon: "≡", group: "More" },
  { key: "settings", label: "Settings", icon: "⚙" },
] as const;

/** All navigable menu section keys. */
export const NAV_KEYS: readonly string[] = NAV.map((n) => n.key);
