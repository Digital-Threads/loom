// D2.1 — pure parser for `loom serve` flags (testable without spawning).
export interface ServeArgs {
  port: number;
  open: boolean;
  project?: string;
}

export function parseServeArgs(args: string[], defaultPort: number): ServeArgs {
  let port = defaultPort;
  let open = true;
  let project: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port") port = Number(args[++i]) || defaultPort;
    else if (a === "--no-open") open = false;
    else if (a === "--project") project = args[++i];
  }
  return { port, open, project };
}
