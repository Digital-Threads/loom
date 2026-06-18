import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../src/core/store/db.js";
import { createApi } from "../../src/web/api.js";
import type Database from "better-sqlite3";
import type { Hono } from "hono";

let dir: string;
let db: Database.Database;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-secapi-"));
  db = openStore(join(dir, "test.db"));
  app = createApi(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", body: JSON.stringify(body) });

describe("security config api", () => {
  it("GET /api/security/policy returns defaults + empty user lists", async () => {
    const res = await app.request("/api/security/policy");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { defaults: { deny: string[] }; allow: string[]; deny: string[] };
    expect(Array.isArray(body.defaults.deny)).toBe(true);
    expect(body.defaults.deny.length).toBeGreaterThan(0);
    expect(body.allow).toEqual([]);
    expect(body.deny).toEqual([]);
  });

  it("POST /api/security/policy persists and rejects bad regex", async () => {
    const ok = await post("/api/security/policy", { allow: ["^npm\\s+test"], deny: ["\\bx\\b"] });
    expect(ok.status).toBe(200);
    const back = (await (await app.request("/api/security/policy")).json()) as { allow: string[]; deny: string[] };
    expect(back.allow).toEqual(["^npm\\s+test"]);
    expect(back.deny).toEqual(["\\bx\\b"]);

    const bad = await post("/api/security/policy", { allow: ["("], deny: [] });
    expect(bad.status).toBe(400);
  });

  it("GET/POST /api/security/secrets round-trips rules and the switch", async () => {
    const init = (await (await app.request("/api/security/secrets")).json()) as { defaults: string[]; enabled: boolean };
    expect(init.enabled).toBe(true);
    expect(init.defaults.length).toBeGreaterThan(0);

    const ok = await post("/api/security/secrets", { custom: [{ kind: "internal", source: "INT-[0-9]{4}" }], enabled: false });
    expect(ok.status).toBe(200);
    const back = (await (await app.request("/api/security/secrets")).json()) as { custom: { kind: string }[]; enabled: boolean };
    expect(back.enabled).toBe(false);
    expect(back.custom).toEqual([{ kind: "internal", source: "INT-[0-9]{4}" }]);

    const bad = await post("/api/security/secrets", { custom: [{ kind: "bad", source: "(" }], enabled: true });
    expect(bad.status).toBe(400);
  });
});
