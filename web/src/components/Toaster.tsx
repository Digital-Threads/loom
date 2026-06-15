import { useEffect, useState } from "react";
import { subscribeToasts, type Toast } from "../toast";

// Renders the toast bus in the corner. Mounted once at the app root.
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (!toasts.length) return null;
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>{t.msg}</div>
      ))}
    </div>
  );
}
