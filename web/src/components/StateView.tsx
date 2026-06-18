import { type ReactNode } from "react";

// Shared loading / empty / error state used across sections, so every screen
// shows the same thing in the same way. `action` is an optional call-to-action
// (e.g. a button) shown under the message on the empty state.
export function StateView({ kind, msg, action }: { kind: "loading" | "empty" | "error"; msg?: string; action?: ReactNode }) {
  if (kind === "loading") return <div className="state-loading"><span className="spin" />{msg ?? "Loading…"}</div>;
  if (kind === "error") return <div className="state-err">⚠ {msg ?? "Something went wrong"}</div>;
  return (
    <div className="state-empty">
      {msg ?? "Nothing here yet"}
      {action ? <div className="state-cta">{action}</div> : null}
    </div>
  );
}
