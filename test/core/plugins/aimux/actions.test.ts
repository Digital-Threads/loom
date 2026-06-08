import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setAimuxDir,
  saveConfig,
  createDefaultConfig,
  loadConfig,
  loadActiveProfile,
} from "@digital-threads/aimux/core";
import { addSubscription, plugin } from "../../../../src/core/plugins/aimux/adapter.js";

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

describe("aimux actions — login (exit-and-handover)", () => {
  const login = () => plugin.actions!.find((a) => a.id === "login")!;

  it("с профилем возвращает ok + handover-thunk (не вызываем — спавнит)", () => {
    const res = login().run({ projectRoot: "" }, { profile: "x" });
    expect(res.ok).toBe(true);
    expect(typeof res.handover).toBe("function");
  });

  it("без профиля возвращает ошибку без handover", () => {
    const res = login().run({ projectRoot: "" }, { profile: "" });
    expect(res.ok).toBe(false);
    expect(res.handover).toBeUndefined();
  });
});

describe("aimux actions — switchProfile", () => {
  const switchProfile = () => plugin.actions!.find((a) => a.id === "switchProfile")!;

  it("action существует и просит профиль через prompt", () => {
    const action = switchProfile();
    expect(action).toBeDefined();
    expect(action.prompt?.some((p) => p.key === "profile")).toBe(true);
  });

  it("пустой профиль → { ok: false } без записи активного профиля", () => {
    const res = switchProfile().run({ projectRoot: "" }, { profile: "" });
    expect(res.ok).toBe(false);
    expect(loadActiveProfile()).toBeNull();
  });

  it("известный профиль → ok и сохраняет активный профиль", () => {
    // createDefaultConfig("main") создаёт профиль "main" в изолированном tmp aimuxDir.
    const res = switchProfile().run({ projectRoot: "" }, { profile: "main" });
    expect(res.ok).toBe(true);
    expect(loadActiveProfile()).toBe("main");
  });

  it("неизвестный профиль → { ok: false } и активный профиль не меняется", () => {
    const res = switchProfile().run({ projectRoot: "" }, { profile: "ghost" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ghost");
    expect(loadActiveProfile()).toBeNull();
  });
});
