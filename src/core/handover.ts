// Registry for a deferred "terminal handover" (exit-and-handover). An interactive
// child process (e.g. aimux launchProfile with OAuth) cannot run inside a
// live Ink render -- it owns the terminal. So the action stores a thunk here,
// ViewRenderer tears down Ink (exit), and cli.tsx runs the thunk after waitUntilExit.
export type HandoverThunk = () => unknown | Promise<unknown>;

let pending: HandoverThunk | null = null;

export function requestHandover(fn: HandoverThunk): void {
  pending = fn;
}

export function takeHandover(): HandoverThunk | null {
  const p = pending;
  pending = null;
  return p;
}
