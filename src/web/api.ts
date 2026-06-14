// Local HTTP API over the core store — the backend the React web-UI (and the
// Tauri sidecar) talk to. Read endpoints first; mutations land in later slices.
// The db is injected so the API is testable with a seeded in-memory store.

import { Hono } from "hono";
import type Database from "better-sqlite3";
import { listTasks, getTask, getStages } from "../core/store/db.js";
import { getSteps } from "../core/store/steps.js";
import { getCosts } from "../core/store/execute.js";
import { boardColumns, attentionQueue } from "../core/pipeline/engine.js";

export function createApi(db: Database.Database): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Board view-model: 9 stage columns with their cards.
  app.get("/api/board", (c) => c.json({ columns: boardColumns(db) }));

  // Attention queue: tasks parked at a gated stage.
  app.get("/api/attention", (c) => c.json({ items: attentionQueue(db) }));

  // All tasks (newest first).
  app.get("/api/tasks", (c) => c.json({ tasks: listTasks(db) }));

  // One task: identity + stages + steps + cost rollups.
  app.get("/api/tasks/:id", (c) => {
    const id = c.req.param("id");
    const task = getTask(db, id);
    if (!task) return c.json({ error: "not found" }, 404);
    return c.json({
      task,
      stages: getStages(db, id),
      steps: getSteps(db, id),
      costs: getCosts(db, id),
    });
  });

  return app;
}
