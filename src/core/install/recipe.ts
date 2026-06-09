import type { InstallRecipe, RecipeStep, DetectSpec } from "../plugins/contract.js";
import type { InstallDeps } from "./types.js";

export type Scope = "user" | "project";
export interface RecipeCtx {
  scope: Scope; dryRun?: boolean; platform?: NodeJS.Platform;
  // injection of the preflight check (tests); prod default = the real checkPrerequisites
  preflightCheck?: (names: string[]) => { ok: boolean; missing: string[]; tools: { name: string; hint: string }[] };
}
export interface RunResult { ok: boolean; error?: string; warning?: string; planned?: string[][]; manual?: string[][]; }
export interface DetectResult { installed: boolean; version?: string; }

export function isValidScope(s: string): s is Scope {
  return s === "user" || s === "project";
}

// Launcher wrappers that on Windows exist as *.cmd shims
// (execFileSync without a shell does not find them by their bare name).
const WIN_CMD_LAUNCHERS = new Set(["npm", "npx", "cargo", "claude", "bun", "bunx", "yarn", "pnpm"]);

// Resolve the executable name for the platform. Pure.
export function resolveLauncher(cmd: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32" && WIN_CMD_LAUNCHERS.has(cmd)) return `${cmd}.cmd`;
  return cmd;
}

// Resolve the probe command for the platform: which->where on win32; otherwise via launcher. Pure.
export function resolveProbeCmd(cmd: string, platform: NodeJS.Platform = process.platform): string {
  if (cmd === "which") return platform === "win32" ? "where" : "which";
  return resolveLauncher(cmd, platform);
}
// Replaces the "{scope}" placeholder with the real scope. Pure.
export function substituteScope(args: string[], scope: Scope): string[] {
  return args.map((a) => (a === "{scope}" ? scope : a));
}

// Runs the steps in order. Defensive: a required failure -> stop+error; optional -> warning.
// dryRun -> does not run, returns planned (cmd+args after substitution).
export function runRecipe(steps: RecipeStep[], ctx: RecipeCtx, deps: InstallDeps): RunResult {
  const planned: string[][] = [];
  const manual: string[][] = [];
  let warning: string | undefined;
  const platform = ctx.platform ?? process.platform;
  for (const step of steps) {
    if (step.scoped && !isValidScope(ctx.scope)) {
      return { ok: false, error: `invalid scope: ${ctx.scope}` };
    }
    const args = step.scoped ? substituteScope(step.args, ctx.scope) : step.args;
    const realCmd = resolveProbeCmd(step.cmd, platform);
    if (step.interactive) {
      manual.push([realCmd, ...args]); // collect, do NOT run
      continue;                         // auto steps continue to run
    }
    planned.push([realCmd, ...args]);
    if (ctx.dryRun) continue;
    const res = deps.run(realCmd, args);
    if (!res.ok) {
      const msg = res.stderr || `step failed: ${step.cmd}`;
      if (step.optional) { warning = warning ? `${warning}; ${msg}` : msg; continue; }
      return { ok: false, error: msg, planned };
    }
  }
  return { ok: true, warning, planned, manual: manual.length ? manual : undefined };
}

// Detect: probe; installed = probe.ok (+ presenceMatch if set); version = versionRegex(probe.stdout).
export function detect(spec: DetectSpec, deps: InstallDeps, platform: NodeJS.Platform = process.platform): DetectResult {
  const res = deps.run(resolveProbeCmd(spec.probe.cmd, platform), spec.probe.args);
  if (!res.ok) return { installed: false };
  if (spec.presenceMatch && !new RegExp(spec.presenceMatch).test(res.stdout)) {
    return { installed: false };
  }
  let version: string | undefined;
  if (spec.versionRegex) {
    const m = new RegExp(spec.versionRegex).exec(res.stdout);
    if (m && m[1]) version = m[1];
  }
  return { installed: true, version };
}

export interface UpdateResult extends DetectResult {
  latest?: string;
  updateAvailable?: boolean; // undefined = unknown
}

// Numeric semver comparison by segments (no pre-release). Pure.
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function detectUpdate(
  spec: DetectSpec, deps: InstallDeps, platform: NodeJS.Platform = process.platform,
): UpdateResult {
  const base = detect(spec, deps, platform);
  if (!base.installed) return { ...base, updateAvailable: false };
  if (!spec.latest || !base.version) return { ...base, updateAvailable: undefined };

  const res = deps.run(resolveProbeCmd(spec.latest.probe.cmd, platform), spec.latest.probe.args);
  if (!res.ok) return { ...base, updateAvailable: undefined };
  const latest = spec.latest.versionRegex
    ? new RegExp(spec.latest.versionRegex).exec(res.stdout)?.[1]
    : res.stdout.trim() || undefined;
  if (!latest) return { ...base, updateAvailable: undefined };

  return { ...base, latest, updateAvailable: compareVersions(latest, base.version) > 0 };
}

// Backward-compat: no manifest.install -> synthesize a recipe from claudePlugin.
export function synthesizeRecipeFromClaudePlugin(
  cp: { name: string; marketplace: string; source?: string },
): InstallRecipe {
  const install: RecipeStep[] = [];
  if (cp.source) install.push({ cmd: "claude", args: ["plugin","marketplace","add","--", cp.source] });
  install.push({ cmd: "claude", args: ["plugin","install","--scope","{scope}","--", `${cp.name}@${cp.marketplace}`], scoped: true });
  return {
    install,
    detect: { probe: { cmd: "claude", args: ["plugin","list"] }, versionRegex: undefined },
    remove: [{ cmd: "claude", args: ["plugin","uninstall","--", `${cp.name}@${cp.marketplace}`] }],
  };
}
