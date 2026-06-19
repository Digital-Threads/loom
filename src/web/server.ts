// Serve the Loom app: the Hono API + the built React frontend (web/dist).
// Runs under Node via @hono/node-server (no Bun runtime dependency).

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApi } from "./api.js";
import { openStore, storePath } from "../core/store/db.js";
import { configureSecurity } from "../core/security/config.js";
import { appendLoomEvent } from "../core/spine/event-bus.js";
import { resolveProjectRoot, deriveProjectId } from "../core/workspace/project-id.js";
import type Database from "better-sqlite3";

export const DEFAULT_PORT = 4317;

/** Open the core store for the current working directory's project. */
export function defaultDb(): Database.Database {
  return openStore(storePath(deriveProjectId(resolveProjectRoot(process.cwd()))));
}

export interface ServeOptions {
  db?: Database.Database;
  port?: number;
  /** Bind address. Default 127.0.0.1 (localhost-only) — the API has no auth, so
   *  it must not be exposed on the network. Override to "0.0.0.0" deliberately. */
  hostname?: string;
  /** Directory of the built frontend (web/dist). Static + SPA fallback served
   *  when present; omitted in API-only / test mode. */
  webDist?: string;
}

/** Start the server: API under /api, static frontend otherwise. */
export function serveApi(opts: ServeOptions = {}) {
  const db = opts.db ?? defaultDb();
  const port = opts.port ?? DEFAULT_PORT;

  // Wire the extracted security layer to the host: route audit events to the
  // event bus (the package's default sink is a no-op). The worktree data dir
  // default already matches loomDataDir, so it needs no override.
  configureSecurity({ emit: (projectId, ev) => appendLoomEvent(projectId, ev as never) });

  const app = new Hono();
  const api = createApi(db);
  app.route("/", api);

  // leak-guard: at boot, reclaim worktrees/branches left behind by done or
  // deleted tasks (and prune stale git admin records).
  (api as { sweepLeakedWorktrees?: () => void }).sweepLeakedWorktrees?.();

  // Auto-fallback timer: periodically move tasks parked on a rate limit to a
  // subscription that still has headroom, so autopilot recovers without a human.
  // unref so it never keeps the process alive on its own.
  const fallbackTimer = setInterval(() => {
    (api as { autoFallbackTick?: () => Promise<void> }).autoFallbackTick?.().catch(() => {});
  }, 30_000);
  (fallbackTimer as { unref?: () => void }).unref?.();

  if (opts.webDist && existsSync(opts.webDist)) {
    const root = opts.webDist;
    // Cache policy: hash-named build assets are immutable → cache forever; HTML
    // (and the SPA fallback) must NEVER be cached, or a browser keeps serving an
    // old index.html that references stale asset hashes after Loom updates — so
    // the user never sees the new build even on reload.
    app.use("/*", async (c, next) => {
      await next();
      const p = c.req.path;
      if (p.startsWith("/api")) return;
      if (p.startsWith("/assets/")) c.header("Cache-Control", "public, max-age=31536000, immutable");
      else c.header("Cache-Control", "no-cache");
    });
    app.use("/*", serveStatic({ root }));
    // SPA fallback: any non-/api path → index.html.
    app.get("*", serveStatic({ path: join(root, "index.html") }));
  }

  const hostname = opts.hostname ?? "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname });
  // Long-lived SSE run streams stay open while the agent thinks (far longer than
  // Node's default timeouts), so disable the request/socket cutoffs.
  const httpServer = server as unknown as { timeout?: number; requestTimeout?: number; close: () => void };
  httpServer.timeout = 0;
  httpServer.requestTimeout = 0;
  const url = new URL(`http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}/`);
  return { url, stop: () => httpServer.close() };
}
