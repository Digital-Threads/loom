import type { InstallRecipe, RecipeStep, DetectSpec } from "@digital-threads/loom-contract";
import type { InstallDeps } from "./types.js";

export type Scope = "user" | "project";
export interface RecipeCtx { scope: Scope; dryRun?: boolean; }
export interface RunResult { ok: boolean; error?: string; warning?: string; planned?: string[][]; }
export interface DetectResult { installed: boolean; version?: string; }

export function isValidScope(s: string): s is Scope {
  return s === "user" || s === "project";
}
// Заменяет плейсхолдер "{scope}" реальным scope. Чистая.
export function substituteScope(args: string[], scope: Scope): string[] {
  return args.map((a) => (a === "{scope}" ? scope : a));
}

// Прогоняет шаги по порядку. Defensive: обязательный провал → стоп+error; optional → warning.
// dryRun → не запускает, возвращает planned (cmd+args после подстановки).
export function runRecipe(steps: RecipeStep[], ctx: RecipeCtx, deps: InstallDeps): RunResult {
  const planned: string[][] = [];
  let warning: string | undefined;
  for (const step of steps) {
    if (step.scoped && !isValidScope(ctx.scope)) {
      return { ok: false, error: `invalid scope: ${ctx.scope}` };
    }
    const args = step.scoped ? substituteScope(step.args, ctx.scope) : step.args;
    planned.push([step.cmd, ...args]);
    if (ctx.dryRun) continue;
    const res = deps.run(step.cmd, args);
    if (!res.ok) {
      const msg = res.stderr || `step failed: ${step.cmd}`;
      if (step.optional) { warning = warning ? `${warning}; ${msg}` : msg; continue; }
      return { ok: false, error: msg, planned };
    }
  }
  return { ok: true, warning, planned };
}

// Детект: probe; installed = probe.ok (+ presenceMatch, если задан); version = versionRegex(probe.stdout).
export function detect(spec: DetectSpec, deps: InstallDeps): DetectResult {
  const res = deps.run(spec.probe.cmd, spec.probe.args);
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

// Backward-compat: нет manifest.install → синтезируем рецепт из claudePlugin.
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
