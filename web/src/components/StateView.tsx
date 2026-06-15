// Shared loading / empty / error state used across sections, so every screen
// shows the same thing in the same way.
export function StateView({ kind, msg }: { kind: "loading" | "empty" | "error"; msg?: string }) {
  if (kind === "loading") return <div className="state-loading"><span className="spin" />{msg ?? "Loading…"}</div>;
  if (kind === "error") return <div className="state-err">⚠ {msg ?? "Something went wrong"}</div>;
  return <div className="state-empty">{msg ?? "Nothing here yet"}</div>;
}
