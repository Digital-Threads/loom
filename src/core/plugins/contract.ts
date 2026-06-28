// The Loom plugin contract -- ONLY the types of the Loom plugin contract.
// No runtime values: tsc resolves these types via the "types" field of package.json,
// type imports are erased, no package build is needed.
//
// The host's runtime logic (LOOM_CONTRACT_VERSION, validateManifest, loader, views,
// derivations, metrics) STAYS in loom-host -- it is not the contract.

export type SettingFieldType = "string" | "number" | "boolean" | "enum";

export interface SettingField {
  key: string;          // flat or dotted path, e.g. "hooks.mode"
  label: string;
  type: SettingFieldType;
  options?: string[];   // only for type==="enum"
  readonly?: boolean;   // token-pilot string fields ("edit the file") -> not editable in the UI
}

export interface SettingsSchema {
  fields: SettingField[];
}

export interface LoomContext {
  projectRoot: string;
  // -- Capability DI (D1) — host-injected surfaces a behavior layer may use.
  // All optional: absent in standalone use, so the plugin behaves autonomously
  // and never imports Loom (one-way dependency, iron rule #5).
  /** The run's spine ids (project/profile/task/workflow). */
  spine?: { projectId: string; profileId?: string; taskId?: string; workflowId?: string };
  /** Append a LoomEvent to the bus (typed as unknown to avoid pulling the event
   *  type into the contract package). */
  appendEvent?: (event: unknown) => void;
  /** Read-only store handle the host passes for layers that need board/run data. */
  storeRead?: unknown;
  /** Sandbox surface (worktree/policy) injected by security (L10). */
  sandbox?: unknown;
  /** Minimal logger; all methods optional. */
  logger?: { info?(m: string): void; warn?(m: string): void; error?(m: string): void };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  // exit-and-handover: a thunk run AFTER exiting Ink (for interactive
  // child processes that need the terminal). See core/handover.ts.
  handover?: () => unknown | Promise<unknown>;
}

export interface PluginAction {
  id: string;
  label: string;
  confirm?: boolean; // irreversible action -> requires confirmation in the UI
  // Free-text input before launch: each field is collected via TextInput,
  // values land in args by key. Empty/absent -- behaves as before.
  prompt?: { key: string; label: string }[];
  run(ctx: LoomContext, args?: Record<string, unknown>): ActionResult;
}

export interface PluginSettings {
  schema: SettingsSchema;
  read(ctx: LoomContext): Record<string, unknown>;
  write(ctx: LoomContext, updates: Record<string, unknown>): boolean;
}

export interface PluginTab {
  id: string;    // stable tab id
  title: string; // displayed name
}

// -- Platform layer (LP1) ------------------------------------------------------
// The 8 AI-development layers from the vision, section 3. Optional: dynamic plugins without
// a declared layer are valid (they go into the undefined group).
export type LoomCategory =
  | "accounts"      // access/accounts (aimux)
  | "efficiency"    // efficiency/tokens (token-pilot)
  | "memory"        // memory/reasoning (task-journal)
  | "learning"      // learning (future layer)
  | "knowledge"     // knowledge (future layer)
  | "quality"       // quality (future layer)
  | "automation"    // automation (future layer)
  | "observability" // observability (future layer)
  | "security"      // sandbox/isolation (L10)
  | "extensibility"; // catalog/SDK/verify (L11)

// Declaration of a plugin's capabilities (LP1). "Has/has not" flags, not commands.
// install -- whether there is an install recipe (the real commands arrive in LP2);
// here only the presence flag. data/settings/actions -- what the plugin brings.
export interface PluginCapabilities {
  install: boolean;   // the adapter has an install recipe (LP2); false for now
  data: boolean;      // the plugin returns data via load()
  settings: boolean;  // there are editable settings (non-empty settings.schema)
  actions: boolean;   // there is at least one action
  execute?: boolean;  // behavior layer: implements execute() (D1)
  slots?: boolean;    // contributes stage slots (D1)
}

// -- Capability facet (D1) — behavior layers (automation/swarm/quality/…) run
// work, not just display data. Step/Result are minimal placeholders here; L4
// (automation) refines the concrete shapes. Kept loose so the contract package
// stays a leaf with no dependency on the store/automation types.
export interface CapabilityStep {
  id: string;
  [k: string]: unknown;
}
export interface CapabilityResult {
  ok: boolean;
  [k: string]: unknown;
}
/** Rough pre-run cost estimate the router/learning can use. */
export interface CostHint {
  estUsd?: number;
  estTokens?: number;
}
/** A layer plugs a skill into a pipeline stage slot (Review/QA/planner/…). The
 *  flow-config resolver (L6.1) picks which contribution runs per stage. */
export interface SlotContribution {
  stage: string;     // pipeline stage key (analysis/brainstorm/…/review/qa/pr)
  skill: string;     // skill backing the slot (code-review/simplify/…)
  passId?: string;   // optional pass identifier within the stage
}

// the data source is abstracted behind load(): the plugin itself knows the method (core-import / file / CLI)
export interface LoomPlugin<TData = unknown> {
  id: string;
  title: string;
  category?: LoomCategory; // layer slot; absence = no layer declared
  capabilities?: PluginCapabilities; // capability declaration (LP1)
  tabs: PluginTab[];                                 // tabs the plugin contributes
  load(ctx: LoomContext): TData | Promise<TData>;    // fetching the plugin's data
  settings?: PluginSettings;
  actions?: PluginAction[];
  views?: Record<string, ViewSpec | ViewSpec[]>;     // key = PluginTab.id; an array = views top-to-bottom
  // Single-plugin derivations for {fn} in view specs -- they know their own plugin's event schema.
  // data -- WorkspaceData at host runtime; in the types-only contract the type is unknown,
  // so as not to pull WorkspaceData into this package.
  derivations?: Record<string, (data: unknown, ...args: unknown[]) => unknown>;
  // -- Capability facet (D1) — present on behavior layers, absent on display
  // plugins (the 3 core modules). The code orchestrator (L4 run-manager / L13
  // conductor) discovers these via the registry, never by direct import.
  /** Run a step; the host injects spine/sandbox/event surfaces via ctx. */
  execute?(step: CapabilityStep, ctx: LoomContext): Promise<CapabilityResult>;
  /** Stage slots this layer backs (Review/QA/planner/…). */
  slots?: SlotContribution[];
  /** Pre-run cost estimate for routing/learning. */
  costHint?(step: CapabilityStep): CostHint;
  /** Models this layer can drive (router hint). */
  models?: string[];
}

// -- Declarative view schema (Task 7.2) ----------------------------------------
// The plugin describes a tab as data (ViewSpec); the host draws it with a generic renderer.

export type FieldRef = string;          // dotted path in the view context
export type Bind = FieldRef | { fn: string; args?: (FieldRef | string | number | boolean)[] };
// A Bind resolves against the context: WorkspaceData + (for detail) idParam + (for action) the selected row.
// FieldRef "x.y" -> path; {fn} -> derivations[fn](data, ...resolvedArgs).

export interface Column {
  header?: string;
  value: FieldRef;                      // path in the row
  width?: number;
  align?: "left" | "right";
  marker?: { when: FieldRef; truthy: string; falsy?: string; equals?: string | number | boolean }; // ★ / ✓○
  // equals set -> truthy marker when value === equals (task status: "closed" -> "checkmark").
  // equals not set -> old truthy behavior Boolean(value) (for isSource subscriptions).
}

export interface ActionBinding {
  key: string;                          // "c","t"
  actionId: string;                     // resolves loomRegistry.get(pluginId).actions
  args?: Record<string, Bind>;          // static path OR computed
  label?: string;                       // hotkey legend
  confirmPrompt?: string;               // y/n confirmation text (for parity with the panels)
}                                        // whether confirmation is needed -- read from PluginAction.confirm

export interface SummaryView {
  kind: "summary";
  lines: { label: string; value: Bind; color?: string; when?: FieldRef }[];
}

export interface TableView {
  kind: "table";
  source: Bind;                         // path to the array ("sessions") OR a derivation ({fn:"sessionsWithTokens"})
  rowKey: FieldRef;                     // e.g. "sessionId"
  columns: Column[];
  empty?: string;
  gap?: number;                         // number of separator spaces between columns (default 2)
  selectable?: boolean;                 // enables up/down + Enter
  onSelect?: { openView: string; passId: FieldRef };  // list→detail
  actions?: ActionBinding[];
}

export interface DetailSection {
  label: string;
  items: Bind;                          // array (path or {fn})
  itemText: FieldRef;                   // path inside the item, e.g. "text"
  empty?: string;
  note?: string;                        // dim suffix on the heading (e.g. "(time-based heuristic)")
  hideCount?: boolean;                  // don't show "(N)" on the heading (the "Task tokens" block)
  lead?: Bind;                          // line under the heading without a bullet (token total)
  trailer?: Bind;                       // dim line after the list (rendered only if non-empty)
}

export interface DetailView {
  kind: "detail";
  idParam: string;                      // passed through from table.onSelect.passId
  title: Bind;
  sections: DetailSection[];
  scalars?: { label: string; value: Bind }[];  // the "Task tokens" block
  actions?: ActionBinding[];
}

export interface FormView {
  kind: "form";
  source: "registry-settings";         // special: the host reads loomRegistry
}

export type ViewSpec = SummaryView | TableView | DetailView | FormView;

// -- Plugin manifest (type) ----------------------------------------------------
// Interface only. LOOM_CONTRACT_VERSION and validateManifest are the host's runtime logic,
// they stay in loom-host/src/core/plugins/manifest.ts.
export interface LoomPluginManifest {
  // identification
  schemaVersion: 1; // manifest format version
  type: "loom-plugin"; // discriminator
  name: string; // = LoomPlugin.id, unique
  title: string; // displayed
  version: string; // semver of the plugin code
  apiVersion: string; // LoomPlugin contract version ("^1.0")
  description?: string;
  author?: { name: string; email?: string; url?: string };
  keywords?: string[];

  // code loading
  entry: string; // path to the built ESM, e.g. "./dist/adapter.js"
  export?: string; // export name, default "plugin"

  // what it brings -- for preview/menu/permissions BEFORE the dynamic import()
  provides: {
    tabs: { id: string; title: string }[];
    settings?: boolean;
    actions?: { id: string; label: string }[];
    executes?: boolean;                          // behavior layer with execute() (D1)
    slots?: { stage: string; skill: string }[]; // stage slots contributed (D1)
  };

  // permissions (declarative; verb:target format). v1 -- stored+shown, NOT enforced.
  permissions?: string[];

  // link to the real CC plugin
  claudePlugin?: {
    name: string;
    marketplace: string;
    source?: string | { source: "github"; repo: string };
  };

  // install recipe (LP2). Absent -> the host synthesizes one from claudePlugin (shim).
  install?: InstallRecipe;
}

// -- Install recipe (LP2) ------------------------------------------------------
// Install a tool from its GitHub Release prebuilt binaries (no build-from-source).
// The host downloads the platform asset, verifies its sha256 against the release's
// checksums.txt, and extracts the named binaries onto PATH (loom-hwfu).
export interface FetchReleaseSpec {
  repo: string;        // "owner/name", e.g. "Digital-Threads/Task-Journal"
  tag: string;         // pinned release tag, e.g. "v0.28.3"
  name: string;        // asset prefix, e.g. "task-journal"
  bins: string[];      // binaries inside the archive to install
}

// An install/remove recipe step. cmd+args -- the plugin's public command.
// scoped:true -> the host substitutes the "{scope}" placeholder with the real scope (user|project).
export interface RecipeStep {
  cmd: string;            // "npm" | "claude" | "cargo" | "which" | ... (placeholder when fetchRelease is set)
  args: string[];         // may contain the "{scope}" placeholder
  scoped?: boolean;       // true -> requires scope substitution in args
  optional?: boolean;     // true -> a step failure does NOT fail the recipe (warning only)
  // true -> interactive (OAuth/choice), Loom does NOT run it but hands it to the user (semi-auto).
  interactive?: boolean;
  // set -> the host installs prebuilt binaries from a GitHub Release instead of
  // running cmd/args (the host handles download + checksum + extract).
  fetchRelease?: FetchReleaseSpec;
}

// How to detect that a plugin is installed, and its version.
// Run probe; installed = probe.ok; version = versionFrom(probe.stdout) (if a regex is given).
export interface DetectSpec {
  probe: RecipeStep;      // e.g. {cmd:"npm", args:["ls","-g","@digital-threads/aimux"]}
  versionRegex?: string;  // extract the version from stdout (1st group)
  // presenceMatch: for commands like `claude plugin list`, where probe.ok does NOT mean "the right plugin is installed".
  //   If set -- installed also requires a name match in stdout. (Used in Task 6.)
  presenceMatch?: string;
  // how to learn the latest available version (LP2). Absent -> update status "unknown".
  latest?: { probe: RecipeStep; versionRegex?: string };
}

// Full plugin recipe: install / detect / remove.
export interface InstallRecipe {
  // explicit prerequisite tools (LP2/preflight). Absent -> derived from step.cmd.
  requires?: ("node" | "npm" | "cargo" | "claude")[];
  install: RecipeStep[];  // run in order
  detect: DetectSpec;
  remove: RecipeStep[];   // run in order
}
