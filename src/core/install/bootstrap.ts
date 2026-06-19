import type { DetectSpec, RecipeStep, InstallRecipe } from "../plugins/contract.js";
import type { InstallDeps } from "./types.js";
import type { RecipeCtx } from "./recipe.js";
import { detect, runRecipe } from "./recipe.js";
import { validateManifest } from "../plugins/manifest.js";
import tokenPilotManifest from "../plugins/token-pilot/plugin.json" with { type: "json" };
import taskJournalManifest from "../plugins/task-journal/plugin.json" with { type: "json" };

// One thing the onboarding auto-installer can install: a system tool (cargo,
// claude) or a bundled plugin (token-pilot, task-journal). `why` is shown in the
// UI so the user understands what each piece is for. `requires` lists unit ids
// that must be present first (a plugin that needs cargo/claude).
export interface InstallUnit {
  id: string;
  title: string;
  why: string;
  detect: DetectSpec;
  steps: RecipeStep[];
  /** Steps run when the unit is ALREADY present, to refresh it to the latest
   *  (e.g. `claude plugin update`). Omit → an already-present unit is just
   *  skipped. So Loom keeps its mandatory plugins current, not only installs
   *  the missing ones. */
  update?: RecipeStep[];
  requires?: string[];
}

// A claude plugin's "update" step: refresh it to the marketplace's latest. The
// command is a no-op when already current, so it's safe to run every onboarding.
const pluginUpdate = (ref: string): RecipeStep[] => [{ cmd: "claude", args: ["plugin", "update", ref] }];

// Pull a bundled plugin's install recipe straight from its plugin.json — the
// single source of truth, so we never duplicate the steps here.
function pluginRecipe(raw: unknown): InstallRecipe {
  const v = validateManifest(raw);
  if (!v.ok || !v.manifest.install) throw new Error("invalid bundled plugin manifest");
  return v.manifest.install;
}

const tokenPilot = pluginRecipe(tokenPilotManifest);
const taskJournal = pluginRecipe(taskJournalManifest);

// Ordered: system tools first (they are prerequisites), then the plugins that
// build on them. task-journal needs both cargo (its binary) and claude (plugin).
export const INSTALL_UNITS: InstallUnit[] = [
  {
    id: "cargo",
    title: "Rust toolchain (cargo)",
    why: "Builds the Task Journal binary that stores your task memory.",
    detect: { probe: { cmd: "which", args: ["cargo"] } },
    // rustup's official one-liner; -y runs it non-interactively. Needs a shell
    // for the pipe, hence `sh -c` (makeShellRunner executes it as a pipe).
    steps: [{ cmd: "sh", args: ["-c", "curl https://sh.rustup.rs -sSf | sh -s -- -y"] }],
  },
  {
    id: "claude",
    title: "Claude Code CLI",
    why: "Runs the AI agent that powers every task in Loom.",
    detect: { probe: { cmd: "which", args: ["claude"] } },
    steps: [{ cmd: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] }],
  },
  {
    id: "token-pilot",
    title: "Token Pilot",
    why: "Token-efficient code reading so the agent uses far fewer tokens.",
    detect: tokenPilot.detect,
    steps: tokenPilot.install,
    update: pluginUpdate("token-pilot@token-pilot"),
    requires: ["claude"], // its steps call `claude plugin add/install`
  },
  {
    id: "task-journal",
    title: "Task Journal",
    why: "Persistent task memory that survives across sessions.",
    detect: taskJournal.detect,
    steps: taskJournal.install,
    update: pluginUpdate("task-journal@task-journal"),
    requires: ["cargo", "claude"],
  },
  // Mandatory third-party plugins Loom's pipeline relies on: code review
  // (caveman) and QA (qa-skills, canary). Installed as Claude plugins from their
  // GitHub marketplaces, the same way as token-pilot / task-journal.
  {
    id: "caveman",
    title: "Caveman (code review)",
    why: "Code-review capability Loom drives at the review stage.",
    detect: { probe: { cmd: "claude", args: ["plugin", "list"] }, presenceMatch: "caveman@caveman" },
    steps: [
      { cmd: "claude", args: ["plugin", "marketplace", "add", "https://github.com/JuliusBrussee/caveman"] },
      { cmd: "claude", args: ["plugin", "install", "--scope", "{scope}", "caveman@caveman"], scoped: true },
    ],
    update: pluginUpdate("caveman@caveman"),
    requires: ["claude"],
  },
  {
    id: "qa-skills",
    title: "QA Skills",
    why: "QA capability Loom drives at the QA stage (smoke / UX / security checks).",
    detect: { probe: { cmd: "claude", args: ["plugin", "list"] }, presenceMatch: "qa-skills@neonwatty-qa" },
    steps: [
      { cmd: "claude", args: ["plugin", "marketplace", "add", "https://github.com/neonwatty/qa-skills"] },
      { cmd: "claude", args: ["plugin", "install", "--scope", "{scope}", "qa-skills@neonwatty-qa"], scoped: true },
    ],
    update: pluginUpdate("qa-skills@neonwatty-qa"),
    requires: ["claude"],
  },
  {
    id: "canary",
    title: "Canary (browser QA)",
    why: "Browser-based QA (record + verify user flows) for the QA stage.",
    detect: { probe: { cmd: "claude", args: ["plugin", "list"] }, presenceMatch: "canary@canary-marketplace" },
    steps: [
      { cmd: "claude", args: ["plugin", "marketplace", "add", "https://github.com/wizenheimer/canary"] },
      { cmd: "claude", args: ["plugin", "install", "--scope", "{scope}", "canary@canary-marketplace"], scoped: true },
    ],
    update: pluginUpdate("canary@canary-marketplace"),
    requires: ["claude"],
  },
  {
    id: "context-mode",
    title: "Context Mode",
    why: "Context-management tools Token Pilot uses to keep the agent's context lean.",
    detect: { probe: { cmd: "claude", args: ["plugin", "list"] }, presenceMatch: "context-mode@context-mode" },
    steps: [
      { cmd: "claude", args: ["plugin", "marketplace", "add", "https://github.com/mksglu/context-mode"] },
      { cmd: "claude", args: ["plugin", "install", "--scope", "{scope}", "context-mode@context-mode"], scoped: true },
    ],
    update: pluginUpdate("context-mode@context-mode"),
    requires: ["claude"],
  },
];

// One progress event emitted as the plan runs. The SSE route forwards these to
// the browser; tests collect them to assert the sequence.
export type InstallEvent =
  | { kind: "step"; id: string; title: string; why: string; state: "installing" }
  | { kind: "step"; id: string; title: string; state: "done" | "skipped" | "failed"; message?: string }
  | { kind: "done"; installed: string[]; failed: string[]; skipped: string[] };

export interface InstallSummary { installed: string[]; failed: string[]; skipped: string[]; }

// Keep error text short and free of newlines so a failed step reads as one line.
function trimErr(msg?: string): string {
  const s = (msg ?? "install failed").replace(/\s+/g, " ").trim();
  return s.length > 300 ? `…${s.slice(-300)}` : s;
}

// Runs the units in order. Idempotent: detect() before each — already-present
// units are skipped, not reinstalled. A unit whose prerequisites are not yet
// available is skipped with a "needs X" reason. A failed step is reported but
// does NOT stop the run (independent units still install). Never throws.
export async function runInstallPlan(
  units: InstallUnit[],
  deps: InstallDeps,
  emit: (e: InstallEvent) => void | Promise<void>,
  ctx: RecipeCtx = { scope: "user" },
): Promise<InstallSummary> {
  const available = new Set<string>();
  const installed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const u of units) {
    if (detect(u.detect, deps).installed) {
      available.add(u.id);
      // Already present: refresh it to the latest if the unit knows how (plugins),
      // otherwise just skip (system tools). This keeps mandatory plugins current
      // instead of leaving a stale version in place.
      if (u.update?.length) {
        await emit({ kind: "step", id: u.id, title: u.title, why: u.why, state: "installing" });
        const upd = runRecipe(u.update, ctx, deps);
        if (upd.ok) {
          installed.push(u.id);
          await emit({ kind: "step", id: u.id, title: u.title, state: "done", message: "updated to latest" });
        } else {
          failed.push(u.id);
          await emit({ kind: "step", id: u.id, title: u.title, state: "failed", message: trimErr(upd.error) });
        }
      } else {
        skipped.push(u.id);
        await emit({ kind: "step", id: u.id, title: u.title, state: "skipped", message: "already installed" });
      }
      continue;
    }
    const missingReq = (u.requires ?? []).filter((r) => !available.has(r));
    if (missingReq.length) {
      skipped.push(u.id);
      await emit({ kind: "step", id: u.id, title: u.title, state: "skipped", message: `needs ${missingReq.join(", ")}` });
      continue;
    }
    await emit({ kind: "step", id: u.id, title: u.title, why: u.why, state: "installing" });
    const res = runRecipe(u.steps, ctx, deps);
    if (res.ok) {
      available.add(u.id);
      installed.push(u.id);
      // Surface a partial-success warning (optional step failed) and any
      // interactive step the recipe handed back instead of running.
      const notes: string[] = [];
      if (res.warning) notes.push(res.warning);
      if (res.manual?.length) notes.push(`${res.manual.length} manual step(s) still needed`);
      await emit({ kind: "step", id: u.id, title: u.title, state: "done", message: notes.join("; ") || undefined });
    } else {
      failed.push(u.id);
      await emit({ kind: "step", id: u.id, title: u.title, state: "failed", message: trimErr(res.error) });
    }
  }

  await emit({ kind: "done", installed, failed, skipped });
  return { installed, failed, skipped };
}
