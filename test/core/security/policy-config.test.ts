import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../../src/core/store/db.js";
import type Database from "better-sqlite3";
import {
  checkRegex,
  compileRegex,
  loadSecurityConfig,
  saveCommandPolicy,
  saveSecretConfig,
  effectivePolicy,
  scanWithCustom,
  policySummary,
  defaultDenySources,
  DEFAULT_SECRET_KINDS,
} from "../../../src/core/security/policy-config.js";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-secpol-"));
  db = openStore(join(dir, "test.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("security policy-config", () => {
  it("validates regex sources without throwing", () => {
    expect(checkRegex("^npm\\s+test").ok).toBe(true);
    expect(checkRegex("(").ok).toBe(false);
    expect(checkRegex("").ok).toBe(false);
    expect(compileRegex("(")).toBeNull();
    expect(compileRegex("a.b")).toBeInstanceOf(RegExp);
  });

  it("rejects ReDoS-prone and over-long patterns", () => {
    expect(checkRegex("(a+)+$").ok).toBe(false); // nested quantifier
    expect(checkRegex("(ab|a)*c").ok).toBe(true); // ordinary alternation is fine
    expect(checkRegex("a".repeat(201)).ok).toBe(false); // too long
  });

  it("secret-scan switch is strict boolean (non-boolean does not enable)", () => {
    saveSecretConfig(db, [], "false" as unknown as boolean);
    expect(loadSecurityConfig(db).secretScanEnabled).toBe(false);
    saveSecretConfig(db, [], true);
    expect(loadSecurityConfig(db).secretScanEnabled).toBe(true);
  });

  it("scanWithCustom bounds matches per rule", () => {
    const text = "x".repeat(5000);
    const found = scanWithCustom(text, [{ kind: "x", source: "x" }]);
    expect(found.filter((f) => f.kind === "x").length).toBeLessThanOrEqual(1000);
  });

  it("defaults: scanning on, empty lists, built-in mirrors present", () => {
    const cfg = loadSecurityConfig(db);
    expect(cfg.secretScanEnabled).toBe(true);
    expect(cfg.allow).toEqual([]);
    expect(cfg.deny).toEqual([]);
    expect(cfg.secretRules).toEqual([]);
    expect(defaultDenySources().length).toBeGreaterThan(0);
    expect(DEFAULT_SECRET_KINDS).toContain("anthropic-key");
  });

  it("saves and reloads the command policy", () => {
    const r = saveCommandPolicy(db, ["^npm\\s+(run|test)"], ["\\bfoo\\b"]);
    expect(r.ok).toBe(true);
    const cfg = loadSecurityConfig(db);
    expect(cfg.allow).toEqual(["^npm\\s+(run|test)"]);
    expect(cfg.deny).toEqual(["\\bfoo\\b"]);
  });

  it("rejects an invalid command pattern (does not persist)", () => {
    const r = saveCommandPolicy(db, ["("], []);
    expect(r.ok).toBe(false);
    expect(loadSecurityConfig(db).allow).toEqual([]);
  });

  it("effectivePolicy always includes the built-in deny patterns", () => {
    saveCommandPolicy(db, [], ["\\bcustomdeny\\b"]);
    const pol = effectivePolicy(loadSecurityConfig(db));
    expect(pol.deny!.length).toBe(defaultDenySources().length + 1);
    // DEFAULT_DENY blocks rm -rf / — must still be present.
    expect(pol.deny!.some((re) => re.test("rm -rf /"))).toBe(true);
    expect(pol.deny!.some((re) => re.test("run customdeny now"))).toBe(true);
  });

  it("saves/reloads secret rules and the on/off switch", () => {
    const ok = saveSecretConfig(db, [{ kind: "internal", source: "INT-[0-9]{4}" }], false);
    expect(ok.ok).toBe(true);
    const cfg = loadSecurityConfig(db);
    expect(cfg.secretScanEnabled).toBe(false);
    expect(cfg.secretRules).toEqual([{ kind: "internal", source: "INT-[0-9]{4}" }]);
  });

  it("rejects an invalid secret rule source", () => {
    expect(saveSecretConfig(db, [{ kind: "bad", source: "(" }], true).ok).toBe(false);
  });

  it("scanWithCustom finds built-in and custom secrets, redacted", () => {
    const rules = [{ kind: "internal", source: "INT-[0-9]{6}" }];
    const found = scanWithCustom("token sk-ant-ABCDEFGHIJKLMNOPQRSTUV and INT-123456", rules);
    const kinds = found.map((f) => f.kind);
    expect(kinds).toContain("anthropic-key");
    expect(kinds).toContain("internal");
    // never echo the full custom secret
    expect(found.find((f) => f.kind === "internal")!.preview).not.toContain("INT-123456");
  });

  it("policySummary reports counts and the switch", () => {
    saveCommandPolicy(db, ["a"], ["b", "c"]);
    saveSecretConfig(db, [{ kind: "x", source: "y" }], true);
    const s = policySummary(loadSecurityConfig(db));
    expect(s.allowCount).toBe(1);
    expect(s.denyCount).toBe(2);
    expect(s.secretRuleCount).toBe(1);
    expect(s.defaultDenyCount).toBe(defaultDenySources().length);
    expect(s.defaultSecretKindCount).toBe(DEFAULT_SECRET_KINDS.length);
    expect(s.secretScanEnabled).toBe(true);
  });
});
