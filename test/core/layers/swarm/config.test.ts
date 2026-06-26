import { describe, it, expect } from "vitest";
import { resolveSwarmConfig, applyUltracode, ULTRACODE_STAGES, SWARM_MAX_ATTEMPTS, SWARM_STAGE_DEFAULT } from "../../../../src/core/layers/swarm/config.js";

describe("resolveSwarmConfig (L5 per-stage swarm config)", () => {
  it("defaults to off, attempts=3, no perspectives when nothing is set", () => {
    expect(resolveSwarmConfig(undefined, undefined)).toEqual(SWARM_STAGE_DEFAULT);
  });

  it("per-stage value overrides the global default", () => {
    const r = resolveSwarmConfig({ enabled: true, attempts: 2 }, { attempts: 4 });
    expect(r.enabled).toBe(true); // from global (per-stage didn't set it)
    expect(r.attempts).toBe(4); // per-stage wins
  });

  it("clamps attempts to [1, SWARM_MAX_ATTEMPTS] and rounds", () => {
    expect(resolveSwarmConfig({ attempts: 50 }, undefined).attempts).toBe(SWARM_MAX_ATTEMPTS);
    expect(resolveSwarmConfig({ attempts: 0 }, undefined).attempts).toBe(1);
    expect(resolveSwarmConfig({ attempts: 2.6 }, undefined).attempts).toBe(3);
    expect(resolveSwarmConfig({ attempts: "nope" }, undefined).attempts).toBe(SWARM_STAGE_DEFAULT.attempts);
  });

  it("only `true` enables; sanitizes perspectives to non-empty strings", () => {
    expect(resolveSwarmConfig({ enabled: "yes" }, undefined).enabled).toBe(false);
    expect(resolveSwarmConfig(undefined, { perspectives: ["security", "", 3, "perf"] }).perspectives).toEqual(["security", "perf"]);
    expect(resolveSwarmConfig(undefined, { perspectives: "x" }).perspectives).toEqual([]);
  });
});

describe("applyUltracode (loom-34th — per-task fan-out)", () => {
  const off = { ...SWARM_STAGE_DEFAULT };

  it("forces the swarm on for the hard stages when ultracode is set", () => {
    for (const stage of ULTRACODE_STAGES) {
      expect(applyUltracode(off, stage, true).enabled).toBe(true);
    }
  });

  it("leaves the base config untouched for non-ultracode tasks", () => {
    expect(applyUltracode(off, "spec", false)).toEqual(off); // enabled stays false
    expect(applyUltracode({ ...off, enabled: true }, "impl", false).enabled).toBe(true); // global-on preserved
  });

  it("does not touch stages outside the hard set, even under ultracode", () => {
    expect(applyUltracode(off, "review", true).enabled).toBe(false);
    expect(applyUltracode(off, "qa", true).enabled).toBe(false);
    expect(applyUltracode(off, "analysis", true).enabled).toBe(false);
  });

  it("preserves attempts/perspectives when forcing enabled on", () => {
    const base = { enabled: false, attempts: 4, perspectives: ["simplest", "robust"] };
    expect(applyUltracode(base, "spec", true)).toEqual({ ...base, enabled: true });
  });
});
