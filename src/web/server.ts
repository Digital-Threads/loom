// Serve the local API. Runs under Bun (the host runtime); `declare const Bun`
// keeps tsc happy without pulling bun-types into the whole project. The React
// frontend is served separately (vite dev / Tauri in prod); this exposes /api.

import { createApi } from "./api.js";
import { openStore, storePath } from "../core/store/db.js";
import { resolveProjectRoot, deriveProjectId } from "../core/workspace/project-id.js";
import type Database from "better-sqlite3";

declare const Bun: {
  serve(opts: { port: number; fetch: (req: Request) => Response | Promise<Response> }): {
    stop(): void;
    url: URL;
  };
};

export const DEFAULT_PORT = 4317;

/** Open the core store for the current working directory's project. */
export function defaultDb(): Database.Database {
  return openStore(storePath(deriveProjectId(resolveProjectRoot(process.cwd()))));
}

export interface ServeOptions {
  db?: Database.Database;
  port?: number;
}

/** Start the API server; returns the Bun server handle. */
export function serveApi(opts: ServeOptions = {}) {
  const db = opts.db ?? defaultDb();
  const app = createApi(db);
  const port = opts.port ?? DEFAULT_PORT;
  return Bun.serve({ port, fetch: app.fetch });
}
