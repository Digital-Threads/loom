import type { InstallRecipe, RecipeStep, DetectSpec } from "@digital-threads/loom-contract";
import type { InstallDeps } from "./types.js";

export type Scope = "user" | "project";
export interface RecipeCtx { scope: Scope; dryRun?: boolean; platform?: NodeJS.Platform; }
export interface RunResult { ok: boolean; error?: string; warning?: string; planned?: string[][]; }
export interface DetectResult { installed: boolean; version?: string; }

export function isValidScope(s: string): s is Scope {
  return s === "user" || s === "project";
}

// Обёртки-лаунчеры, которые на Windows существуют как *.cmd-шиммы
// (execFileSync без shell их по «голому» имени не находит).
const WIN_CMD_LAUNCHERS = new Set(["npm", "npx", "cargo", "claude", "bun", "bunx", "yarn", "pnpm"]);

// Резолв исполняемого имени под платформу. Чистая.
export function resolveLauncher(cmd: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32" && WIN_CMD_LAUNCHERS.has(cmd)) return `${cmd}.cmd`;
  return cmd;
}

// Резолв probe-команды под платформу: which→where на win32; прочее — через launcher. Чистая.
export function resolveProbeCmd(cmd: string, platform: NodeJS.Platform = process.platform): string {
  if (cmd === "which") return platform === "win32" ? "where" : "which";
  return resolveLauncher(cmd, platform);
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
  const platform = ctx.platform ?? process.platform;
  for (const step of steps) {
    if (step.scoped && !isValidScope(ctx.scope)) {
      return { ok: false, error: `invalid scope: ${ctx.scope}` };
    }
    const args = step.scoped ? substituteScope(step.args, ctx.scope) : step.args;
    const realCmd = resolveProbeCmd(step.cmd, platform);
    planned.push([realCmd, ...args]);
    if (ctx.dryRun) continue;
    const res = deps.run(realCmd, args);
    if (!res.ok) {
      const msg = res.stderr || `step failed: ${step.cmd}`;
      if (step.optional) { warning = warning ? `${warning}; ${msg}` : msg; continue; }
      return { ok: false, error: msg, planned };
    }
  }
  return { ok: true, warning, planned };
}

// Детект: probe; installed = probe.ok (+ presenceMatch, если задан); version = versionRegex(probe.stdout).
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
