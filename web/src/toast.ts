// Tiny toast bus — module-level so any code (components or the api client) can
// raise a toast without prop-drilling. The Toaster component subscribes.

export type ToastKind = "success" | "error" | "info";
export interface Toast { id: number; kind: ToastKind; msg: string }

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l([...toasts]));

export function subscribeToasts(l: (t: Toast[]) => void): () => void {
  listeners.add(l);
  l([...toasts]);
  return () => { listeners.delete(l); };
}

export function pushToast(kind: ToastKind, msg: string): void {
  const id = ++seq;
  toasts = [...toasts, { id, kind, msg }];
  emit();
  const ttl = kind === "error" ? 6000 : 3000;
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit(); }, ttl);
}

export const toast = {
  success: (m: string) => pushToast("success", m),
  error: (m: string) => pushToast("error", m),
  info: (m: string) => pushToast("info", m),
};
