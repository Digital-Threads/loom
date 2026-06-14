import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import { getCosts } from "../../../src/core/store/execute.js";
import { recordRunCost } from "../../../src/core/observability/cost-recorder.js";
import type { TokenEvent } from "../../../src/core/plugins/token-pilot/adapter.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-cost-"));
  db = openStore(join(dir, "s.db"));
  createTask(db, { id: "t1", title: "x" });
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe("recordRunCost (L9.1 — провод 4)", () => {
  it("writes exact token used/saved into cost_rollups from task-tagged events", () => {
    const tokenEvents: TokenEvent[] = [
      { sessionId: "a", used: 100, saved: 20, ts: 1, agentType: null, taskId: "t1" },
      { sessionId: "b", used: 50, saved: 5, ts: 2, agentType: null, taskId: "other" },
    ];
    recordRunCost(db, "t1", { tokenEvents });
    const costs = getCosts(db, "t1");
    const used = costs.find((c) => c.source === "token-pilot" && c.metric === "used");
    const saved = costs.find((c) => c.source === "token-pilot" && c.metric === "saved");
    expect(used).toMatchObject({ value: 100, exact: 1 });
    expect(saved).toMatchObject({ value: 20, exact: 1 });
  });

  it("records real spend when provided", () => {
    recordRunCost(db, "t1", { tokenEvents: [], spent: 777 });
    const spent = getCosts(db, "t1").find((c) => c.source === "aimux" && c.metric === "spent");
    expect(spent?.value).toBe(777);
  });
});
