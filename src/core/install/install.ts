// Core of the Loom plugin install/remove pipeline (Task 10.2).
// All functions are defensive (do NOT throw). External effects go through deps.run and deps.dataDir.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest } from "../plugins/manifest.js";
import { preflightRecipe } from "./preflight.js";
import { runRecipe, synthesizeRecipeFromClaudePlugin } from "./recipe.js";
import type { RecipeCtx } from "./recipe.js";
import { readInstalled, writeInstalled } from "./registry-file.js";
import type {
  ClaudePluginRef,
  InstallDeps,
  InstallPlan,
  InstallResult,
  InstallSource,
} from "./types.js";

// -- Input validators (argument-injection hardening) --------------------------
// Any user-supplied source ends up in the argv of git/npm/tar/claude. Without a check
// a value like "-x" / "--upload-pack=evil" would smuggle in a flag. All validators are pure
// and exported for tests.

// Value "looks like a flag": starts with "-" (after possible spaces) -- we reject it.
export function isFlagShaped(value: string): boolean {
  return /^\s*-/.test(value);
}

// git url: https?:// | git@host:path | github:owner/repo. No flags/leading spaces.
export function isValidGitUrl(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isFlagShaped(value)) return false;
  if (/^https?:\/\/\S+$/.test(value)) return true;
  if (/^git@[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$/.test(value)) return true;
  if (/^github:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)) return true;
  return false;
}

// npm package-spec: optional scope + name + optional version/range. Not flag-shaped, no leading spaces.
export function isValidNpmSpec(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isFlagShaped(value)) return false;
  return /^(@[a-z0-9-._]+\/)?[a-z0-9-._]+(@[a-z0-9-._^~*x><=. |]+)?$/i.test(value);
}

// claude marketplace source: https?:// | owner/repo (github form) | ./local path. Not flag-shaped.
export function isValidMarketplaceSource(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isFlagShaped(value)) return false;
  if (/^https?:\/\/\S+$/.test(value)) return true;
  if (/^\.{1,2}\//.test(value)) return true; // ./ or ../ local path
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)) return true; // owner/repo
  return false;
}

// Name of the found tgz: only safe characters and the .tgz extension, not flag-shaped.
export function isValidTgzName(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isFlagShaped(value)) return false;
  return /^[A-Za-z0-9._@/+-]+\.tgz$/.test(value);
}

// Human-readable description of the source for the registry entry.
function describeSource(source: InstallSource): string {
  switch (source.type) {
    case "local":
      return `local:${source.path}`;
    case "npm":
      return `npm:${source.spec}`;
    case "git":
      return `git:${source.url}`;
  }
}

// Coerce claudePlugin.source (string | {source:"github";repo} | undefined) to a string.
function normalizeClaudePlugin(
  cp: NonNullable<import("../plugins/contract.js").LoomPluginManifest["claudePlugin"]>,
): ClaudePluginRef {
  let source: string | undefined;
  if (typeof cp.source === "string") {
    source = cp.source;
  } else if (cp.source && typeof cp.source === "object" && cp.source.source === "github") {
    source = cp.source.repo;
  }
  return { name: cp.name, marketplace: cp.marketplace, source };
}

// Defensive: from the synthesized claudePlugin recipe we remove the step
// `claude plugin marketplace add -- <src>` if source is flag-shaped/invalid
// (argument-injection hardening -- previously done by the hardcoded claude finalize branch).
function sanitizeSynthRecipe(
  recipe: import("../plugins/contract.js").InstallRecipe,
): import("../plugins/contract.js").InstallRecipe {
  const install = recipe.install.filter((step) => {
    const isMarketplaceAdd =
      step.cmd === "claude" &&
      step.args[0] === "plugin" &&
      step.args[1] === "marketplace" &&
      step.args[2] === "add";
    if (!isMarketplaceAdd) return true;
    const src = step.args[step.args.length - 1];
    return isValidMarketplaceSource(src);
  });
  return { ...recipe, install };
}

// Places the plugin's raw files into a directory, returns the path to the root (where plugin.json is).
// npm/git actually download via deps.run; in tests run is fake -- no effects.
export function fetchToStaging(
  source: InstallSource,
  deps: InstallDeps,
): { ok: boolean; dir?: string; error?: string } {
  try {
    if (source.type === "local") {
      if (!existsSync(join(source.path, "plugin.json"))) {
        return { ok: false, error: `plugin.json not found in ${source.path}` };
      }
      // We don't copy at this step -- the copy happens at finalization.
      return { ok: true, dir: source.path };
    }

    if (source.type === "npm") {
      if (!isValidNpmSpec(source.spec)) {
        return { ok: false, error: `invalid npm spec: ${source.spec}` };
      }
      const dest = mkdtempSync(join(tmpdir(), "loom-npm-"));
      // end-of-options "--" before spec -- spec cannot be parsed as a flag.
      const packed = deps.run("npm", ["pack", "--pack-destination", dest, "--", source.spec]);
      if (!packed.ok) return { ok: false, error: `npm pack failed: ${packed.stderr}` };
      // npm pack prints the tgz name on stdout (last line). If empty -- search in dest.
      let tgzName = packed.stdout.trim().split(/\r?\n/).pop() ?? "";
      let tgz = tgzName ? join(dest, tgzName) : "";
      if (!tgz || !existsSync(tgz)) {
        const found = existsSync(dest) ? readdirSync(dest).find((f) => f.endsWith(".tgz")) : undefined;
        tgzName = found ?? tgzName;
        tgz = found ? join(dest, found) : tgz;
      }
      // The tgz name must be safe and not flag-shaped (defensive against output tampering).
      if (!isValidTgzName(tgzName)) {
        return { ok: false, error: `invalid tgz name: ${tgzName}` };
      }
      const out = mkdtempSync(join(tmpdir(), "loom-npm-x-"));
      // Guard against a path starting with "-": prefix it with "./". Then "--" before the file.
      const safeTgz = tgz.startsWith("-") ? `./${tgz}` : tgz;
      const ex = deps.run("tar", ["-xzf", "-C", out, "--strip-components=1", "--", safeTgz]);
      if (!ex.ok) return { ok: false, error: `tar extract failed: ${ex.stderr}` };
      return { ok: true, dir: out };
    }

    // git
    if (!isValidGitUrl(source.url)) {
      return { ok: false, error: `invalid git url: ${source.url}` };
    }
    const dir = mkdtempSync(join(tmpdir(), "loom-git-"));
    // end-of-options "--" before url -- url cannot be parsed as a flag.
    const cloned = deps.run("git", ["clone", "--depth", "1", "--", source.url, dir]);
    if (!cloned.ok) return { ok: false, error: `git clone failed: ${cloned.stderr}` };
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? String(err) };
  }
}

// Builds the install plan: fetch -> read plugin.json -> validateManifest -> InstallPlan.
export function planInstall(source: InstallSource, deps: InstallDeps): InstallResult {
  const staged = fetchToStaging(source, deps);
  if (!staged.ok || !staged.dir) {
    return { ok: false, error: staged.error ?? "fetch failed" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(staged.dir, "plugin.json"), "utf8"));
  } catch (err) {
    return { ok: false, error: `cannot read plugin.json: ${(err as Error).message}` };
  }

  const v = validateManifest(raw);
  if (!v.ok) return { ok: false, error: v.error };
  const manifest = v.manifest;

  const recipe = manifest.install
    ?? (manifest.claudePlugin
      ? sanitizeSynthRecipe(synthesizeRecipeFromClaudePlugin(normalizeClaudePlugin(manifest.claudePlugin)))
      : { install: [], detect: { probe: { cmd: "true", args: [] } }, remove: [] });

  const plan: InstallPlan = {
    name: manifest.name,
    version: manifest.version,
    manifest,
    installDir: join(deps.dataDir, "plugins", manifest.name, manifest.version),
    permissions: manifest.permissions ?? [],
    claudePlugin: manifest.claudePlugin
      ? normalizeClaudePlugin(manifest.claudePlugin)
      : undefined,
    recipe,
  };
  return { ok: true, plan };
}

// Performs the install AFTER confirmation: copies files, writes the registry, calls the claude CLI.
// claude errors do NOT fail the Loom part of the install -- they are returned as a warning.
export function finalizeInstall(
  plan: InstallPlan,
  stagingDir: string,
  deps: InstallDeps,
  ctx: RecipeCtx = { scope: "user" },
): { ok: boolean; error?: string; warning?: string; missing?: string[]; manual?: string[][] } {
  const pf = preflightRecipe(plan.recipe, { check: ctx.preflightCheck });
  if (!pf.ok) {
    return { ok: false, missing: pf.missing,
      error: `missing tools: ${pf.missing.join(", ")}${pf.hint ? ` — ${pf.hint}` : ""}` };
  }

  try {
    rmSync(plan.installDir, { recursive: true, force: true });
    mkdirSync(plan.installDir, { recursive: true });
    cpSync(stagingDir, plan.installDir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `copy failed: ${(err as Error).message}` };
  }

  // We run the recipe AFTER copying but BEFORE writing the registry: on a required
  // step's failure we roll back the files and leave no registry entry.
  const rec = runRecipe(plan.recipe.install, ctx, deps);
  if (!rec.ok) {
    rmSync(plan.installDir, { recursive: true, force: true });
    return { ok: false, error: `install recipe failed: ${rec.error}` };
  }

  const reg = readInstalled(deps);
  reg.plugins[plan.name] = {
    version: plan.version,
    installPath: plan.installDir,
    enabled: true,
    source: describeSource({ type: "local", path: stagingDir }),
    installedAt: new Date().toISOString(),
  };
  writeInstalled(deps, reg);

  return { ok: true, warning: rec.warning, manual: rec.manual };
}

// Full pipeline: plan -> confirmation -> finalization.
export function installPlugin(
  source: InstallSource,
  deps: InstallDeps,
  onConfirm: (plan: InstallPlan) => boolean = () => true,
  ctx: RecipeCtx = { scope: "user" },
): InstallResult {
  const planned = planInstall(source, deps);
  if (!planned.ok || !planned.plan) return planned;

  if (!onConfirm(planned.plan)) {
    return { ok: false, error: "cancelled", plan: planned.plan };
  }

  // For local, the source = source.path; for npm/git the staging is already downloaded in fetchToStaging,
  // but planInstall does not return the staging directory -> we re-fetch for finalization.
  const staged = source.type === "local" ? { ok: true, dir: source.path } : fetchToStaging(source, deps);
  if (!staged.ok || !staged.dir) {
    return { ok: false, error: staged.error ?? "fetch failed", plan: planned.plan };
  }

  const fin = finalizeInstall(planned.plan, staged.dir, deps, ctx);
  if (!fin.ok) return { ok: false, error: fin.error, missing: fin.missing, plan: planned.plan };
  return { ok: true, plan: planned.plan, warning: fin.warning, manual: fin.manual };
}

// Removes a plugin: deletes installDir, cleans the registry, tries to remove the claude plugin.
export function removePlugin(
  name: string,
  deps: InstallDeps,
  ctx: RecipeCtx = { scope: "user" },
): { ok: boolean; error?: string } {
  const reg = readInstalled(deps);
  const entry = reg.plugins[name];
  if (!entry) return { ok: false, error: `plugin not installed: ${name}` };

  // Assemble the recipe from the installed plugin.json BEFORE removal (defensive).
  let removeSteps: InstallPlan["recipe"]["remove"] = [];
  try {
    const raw = JSON.parse(readFileSync(join(entry.installPath, "plugin.json"), "utf8")) as unknown;
    const v = validateManifest(raw);
    if (v.ok) {
      const recipe = v.manifest.install
        ?? (v.manifest.claudePlugin
          ? synthesizeRecipeFromClaudePlugin(normalizeClaudePlugin(v.manifest.claudePlugin))
          : { install: [], detect: { probe: { cmd: "true", args: [] } }, remove: [] });
      removeSteps = recipe.remove;
    }
  } catch {
    // missing/corrupt manifest -- skip the remove recipe
  }

  try {
    rmSync(entry.installPath, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: `remove failed: ${(err as Error).message}` };
  }

  delete reg.plugins[name];
  writeInstalled(deps, reg);

  // Defensive: a remove-recipe failure does not block the cleanup.
  runRecipe(removeSteps, ctx, deps);

  return { ok: true };
}
