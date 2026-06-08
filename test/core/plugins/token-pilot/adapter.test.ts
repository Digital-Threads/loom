import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenUsageBySession } from "../../../../src/core/plugins/token-pilot/adapter.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-tp-"));
  mkdirSync(join(dir, ".token-pilot"), { recursive: true });
  const lines = [
    JSON.stringify({ ts: 1, session_id: "aaa", event: "denied", estTokens: 100, summaryTokens: 10, savedTokens: 90 }),
    JSON.stringify({ ts: 2, session_id: "aaa", event: "denied", estTokens: 200, summaryTokens: 20, savedTokens: 180 }),
    JSON.stringify({ ts: 3, session_id: "bbb", event: "denied", estTokens: 50, summaryTokens: 10, savedTokens: 40 }),
    JSON.stringify({ ts: 4, session_id: "diagnostic", event: "diagnostic", estTokens: 0, summaryTokens: 0, savedTokens: 0 }),
  ];
  writeFileSync(join(dir, ".token-pilot", "hook-events.jsonl"), lines.join("\n") + "\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("token-pilot adapter — агрегация по сессиям", () => {
  it("суммирует used/saved по session_id и игнорирует diagnostic", () => {
    const rows = tokenUsageBySession(dir);
    expect(rows.find((r) => r.sessionId === "aaa")).toEqual({ sessionId: "aaa", used: 300, saved: 270 });
    expect(rows.find((r) => r.sessionId === "bbb")).toEqual({ sessionId: "bbb", used: 50, saved: 40 });
    expect(rows.find((r) => r.sessionId === "diagnostic")).toBeUndefined();
  });

  it("сортирует по saved по убыванию", () => {
    const rows = tokenUsageBySession(dir);
    expect(rows.map((r) => r.sessionId)).toEqual(["aaa", "bbb"]);
  });
});

describe("token-pilot adapter — отсутствие файла", () => {
  it("возвращает пустой массив для несуществующего пути", () => {
    expect(tokenUsageBySession("/nonexistent/path")).toEqual([]);
  });
});
