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

// Isolate aimuxDir into a temp folder for each test — the real ~/.aimux is NOT touched.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-aimux-actions-"));
  setAimuxDir(dir);
  saveConfig(createDefaultConfig("main"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("aimux actions — addSubscription", () => {
  it("adds a new profile and persists it to the config", () => {
    const res = addSubscription("mytest", { cli: "claude" });
    expect(res.ok).toBe(true);

    const cfg = loadConfig();
    expect(cfg).not.toBeNull();
    expect(Object.keys(cfg!.profiles)).toContain("mytest");
  });

  it("returns an error when adding an already-existing profile again", () => {
    const first = addSubscription("mytest", { cli: "claude" });
    expect(first.ok).toBe(true);

    const second = addSubscription("mytest");
    expect(second.ok).toBe(false);
    expect(second.error).toBeTruthy();
  });
});

describe("aimux actions — login (exit-and-handover)", () => {
  const login = () => plugin.actions!.find((a) => a.id === "login")!;

  it("with a profile it returns ok + a handover thunk (not invoked — it spawns)", () => {
    const res = login().run({ projectRoot: "" }, { profile: "x" });
    expect(res.ok).toBe(true);
    expect(typeof res.handover).toBe("function");
  });

  it("without a profile it returns an error and no handover", () => {
    const res = login().run({ projectRoot: "" }, { profile: "" });
    expect(res.ok).toBe(false);
    expect(res.handover).toBeUndefined();
  });
});

describe("aimux actions — switchProfile", () => {
  const switchProfile = () => plugin.actions!.find((a) => a.id === "switchProfile")!;

  it("action exists and asks for the profile via prompt", () => {
    const action = switchProfile();
    expect(action).toBeDefined();
    expect(action.prompt?.some((p) => p.key === "profile")).toBe(true);
  });

  it("empty profile → { ok: false } without writing the active profile", () => {
    const res = switchProfile().run({ projectRoot: "" }, { profile: "" });
    expect(res.ok).toBe(false);
    expect(loadActiveProfile()).toBeNull();
  });

  it("known profile → ok and saves the active profile", () => {
    // createDefaultConfig("main") creates the "main" profile in the isolated tmp aimuxDir.
    const res = switchProfile().run({ projectRoot: "" }, { profile: "main" });
    expect(res.ok).toBe(true);
    expect(loadActiveProfile()).toBe("main");
  });

  it("unknown profile → { ok: false } and the active profile is unchanged", () => {
    const res = switchProfile().run({ projectRoot: "" }, { profile: "ghost" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ghost");
    expect(loadActiveProfile()).toBeNull();
  });
});
