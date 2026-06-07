import { describe, it, expect } from "vitest";
import {
  validateManifest,
  LOOM_CONTRACT_VERSION,
  type LoomPluginManifest,
} from "../../../src/core/plugins/manifest.js";

const valid: LoomPluginManifest = {
  schemaVersion: 1,
  type: "loom-plugin",
  name: "token-pilot",
  title: "Token Pilot",
  version: "0.1.0",
  apiVersion: "^1.0",
  entry: "./dist/adapter.js",
  provides: { tabs: [{ id: "tp", title: "Token Pilot" }] },
};

describe("validateManifest", () => {
  it("принимает валидный манифест", () => {
    const r = validateManifest(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.name).toBe("token-pilot");
  });

  it("игнорирует лишние/неизвестные поля (forward-compat)", () => {
    const r = validateManifest({ ...valid, futureField: 42, extra: { a: 1 } });
    expect(r.ok).toBe(true);
  });

  it("не-объект → ok:false", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest("x").ok).toBe(false);
    expect(validateManifest([valid]).ok).toBe(false);
  });

  it("отсутствует type → ok:false", () => {
    const { type, ...rest } = valid;
    const r = validateManifest(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/type/);
  });

  it("type не тот → ok:false", () => {
    const r = validateManifest({ ...valid, type: "cc-plugin" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/type/);
  });

  it("schemaVersion != 1 → ok:false", () => {
    const r = validateManifest({ ...valid, schemaVersion: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schemaVersion/);
  });

  it("нет name → ok:false", () => {
    const { name, ...rest } = valid;
    const r = validateManifest(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/);
  });

  it("пустая name → ok:false", () => {
    const r = validateManifest({ ...valid, name: "" });
    expect(r.ok).toBe(false);
  });

  it("нет title → ok:false", () => {
    const { title, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("нет version → ok:false", () => {
    const { version, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("нет apiVersion → ok:false", () => {
    const { apiVersion, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("нет entry → ok:false", () => {
    const { entry, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("provides.tabs не массив → ok:false", () => {
    const r = validateManifest({ ...valid, provides: { tabs: "nope" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tabs/);
  });

  it("provides отсутствует → ok:false", () => {
    const { provides, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("tab без id/title → ok:false", () => {
    const r = validateManifest({
      ...valid,
      provides: { tabs: [{ id: "x" }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tabs/);
  });

  it("экспортирует LOOM_CONTRACT_VERSION", () => {
    expect(LOOM_CONTRACT_VERSION).toBe("1.0");
  });
});
