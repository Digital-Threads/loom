// Types for the Loom plugin install/remove pipeline (Task 10.2).
// Everything is injected (dataDir + CmdRunner) so tests have no real side effects.
import type { InstallRecipe, LoomPluginManifest } from "../plugins/contract.js";
export type { InstallRecipe } from "../plugins/contract.js";
export type { RecipeCtx, DetectResult, Scope } from "./recipe.js";

// Where we get the plugin from.
export type InstallSource =
  | { type: "local"; path: string }
  | { type: "npm"; spec: string } // "@scope/pkg" or "pkg@1.2.3"
  | { type: "git"; url: string };

// Result of an external command. The runner is defensive -- it does NOT throw.
export interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// Synchronous executor of external commands. In prod = an execFileSync wrapper, in tests = a fake.
export type CmdRunner = (cmd: string, args: string[]) => CmdResult;

// Injected pipeline dependencies.
export interface InstallDeps {
  dataDir: string; // = loomDataDir() in prod, temp in tests
  run: CmdRunner; // = defaultRun in prod, a fake in tests
}

// Normalized claudePlugin: source coerced to a string (or undefined).
export interface ClaudePluginRef {
  name: string;
  marketplace: string;
  source?: string;
}

// Install plan -- what installs and where (before confirmation).
export interface InstallPlan {
  name: string;
  version: string;
  manifest: LoomPluginManifest;
  installDir: string; // <dataDir>/plugins/<name>/<version>
  permissions: string[]; // manifest.permissions ?? []
  claudePlugin?: ClaudePluginRef;
  recipe: InstallRecipe; // from manifest.install or a shim from claudePlugin
}

export interface InstallResult {
  ok: boolean;
  plan?: InstallPlan;
  error?: string;
  warning?: string;
  missing?: string[]; // missing prerequisite tools (preflight, LP2)
  manual?: string[][]; // interactive steps (semi-auto): cmd+args the user runs themselves
}

// Entry in the installed-plugins registry.
export interface InstalledEntry {
  version: string;
  installPath: string;
  enabled: boolean;
  source: string; // human-readable description of the source
  installedAt?: string;
}

export interface InstalledRegistry {
  schemaVersion: 1;
  plugins: Record<string, InstalledEntry>;
}
