import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setAimuxDir, saveConfig, createDefaultConfig, loadConfig } from "@digital-threads/aimux/core";
import { addSubscription } from "@digital-threads/loom-plugin-aimux";

// Изолируем aimuxDir во временную папку на каждый тест — реальный ~/.aimux НЕ трогаем.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-aimux-actions-"));
  setAimuxDir(dir);
  saveConfig(createDefaultConfig("main"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("aimux actions — addSubscription", () => {
  it("добавляет новый профиль и персистит его в конфиг", () => {
    const res = addSubscription("mytest", { cli: "claude" });
    expect(res.ok).toBe(true);

    const cfg = loadConfig();
    expect(cfg).not.toBeNull();
    expect(Object.keys(cfg!.profiles)).toContain("mytest");
  });

  it("возвращает ошибку при повторном добавлении существующего профиля", () => {
    const first = addSubscription("mytest", { cli: "claude" });
    expect(first.ok).toBe(true);

    const second = addSubscription("mytest");
    expect(second.ok).toBe(false);
    expect(second.error).toBeTruthy();
  });
});
