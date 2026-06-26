// L5 swarm — per-stage configuration resolver. A stage may run as a swarm of N
// attempts; this resolves the effective config from stored settings: a per-stage
// value overrides a global default, attempts are clamped to a sane ceiling. Pure
// (takes the raw stored values) so it's testable without the settings store.

export interface StageSwarmConfig {
  /** Run this stage as a swarm. Off by default — swarm is opt-in per stage. */
  enabled: boolean;
  /** Parallel attempts. Clamped to [1, SWARM_MAX_ATTEMPTS]. */
  attempts: number;
  /** Optional per-attempt lenses (index-aligned), e.g. ["security","perf"]. */
  perspectives: string[];
}

export const SWARM_STAGE_DEFAULT: StageSwarmConfig = { enabled: false, attempts: 3, perspectives: [] };
/** Hard ceiling on attempts — swarm is N× cost, so a paste of "50" can't blow up. */
export const SWARM_MAX_ATTEMPTS = 5;

function clampAttempts(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return SWARM_STAGE_DEFAULT.attempts;
  return Math.min(SWARM_MAX_ATTEMPTS, Math.max(1, n));
}

function sanitizePerspectives(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
}

/** The hard stages an ultracode task fans out (swarm) — design + build, where N
 *  approaches pay off; mechanical stages are left alone (loom-34th). */
export const ULTRACODE_STAGES = ["spec", "impl"] as const;

/** Ultracode override: a big task opts into fan-out, so force the swarm on for the
 *  hard stages REGARDLESS of the global per-stage toggle. Other stages and
 *  non-ultracode tasks return the base config unchanged. Pure → testable. */
export function applyUltracode(base: StageSwarmConfig, stage: string, ultracode: boolean): StageSwarmConfig {
  return ultracode && (ULTRACODE_STAGES as readonly string[]).includes(stage) ? { ...base, enabled: true } : base;
}

/** Resolve the effective swarm config for a stage: per-stage value wins over the
 *  global default, both over the built-in defaults. Each input is the raw stored
 *  setting object (or undefined). Never throws — bad values fall back. */
export function resolveSwarmConfig(global: unknown, perStage: unknown): StageSwarmConfig {
  const g = (global && typeof global === "object" ? global : {}) as Partial<Record<keyof StageSwarmConfig, unknown>>;
  const s = (perStage && typeof perStage === "object" ? perStage : {}) as Partial<Record<keyof StageSwarmConfig, unknown>>;
  const pick = <K extends keyof StageSwarmConfig>(k: K): unknown => (s[k] !== undefined ? s[k] : g[k]);
  return {
    enabled: pick("enabled") === true,
    attempts: pick("attempts") === undefined ? SWARM_STAGE_DEFAULT.attempts : clampAttempts(pick("attempts")),
    perspectives: sanitizePerspectives(pick("perspectives")),
  };
}
