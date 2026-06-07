import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setAimuxDir } from "@digital-threads/aimux/core";
import {
  listSubscriptions,
  listHealth,
  listSessions,
} from "@digital-threads/loom-plugin-aimux";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-aimux-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config.yaml"),
    [
      "version: 1",
      "shared_source: ~/.claude",
      "profiles:",
      "  work:",
      "    cli: claude",
      "    path: ~/.claude",
      "    is_source: true",
      "  personal:",
      "    cli: claude",
      "    path: ~/.aimux/profiles/personal",
      "private: []",
      "",
    ].join("\n"),
  );
  setAimuxDir(dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("aimux adapter — подписки", () => {
  it("возвращает имена профилей", () => {
    const subs = listSubscriptions();
    expect(subs.map((s) => s.name).sort()).toEqual(["personal", "work"]);
  });

  it("прокидывает cli и isSource из конфига", () => {
    const subs = listSubscriptions();
    const work = subs.find((s) => s.name === "work");
    expect(work).toEqual({ name: "work", cli: "claude", isSource: true });
    const personal = subs.find((s) => s.name === "personal");
    expect(personal).toEqual({ name: "personal", cli: "claude", isSource: false });
  });
});

describe("aimux adapter — здоровье и сессии", () => {
  it("возвращает health по профилям (массив отчётов)", () => {
    const health = listHealth();
    expect(Array.isArray(health)).toBe(true);
    for (const report of health) {
      expect(typeof report.profile).toBe("string");
      expect(Array.isArray(report.valid)).toBe(true);
      expect(Array.isArray(report.broken)).toBe(true);
    }
  });

  it("возвращает массив сессий", () => {
    const sessions = listSessions();
    expect(Array.isArray(sessions)).toBe(true);
    for (const s of sessions) {
      expect(typeof s.sessionId).toBe("string");
    }
  });
});
