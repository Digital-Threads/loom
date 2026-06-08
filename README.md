# Loom

One terminal screen for the AI-development tools that normally live apart. Loom is a local control center: install plugins from a single catalog, see every layer on one dashboard, and manage them in place. Each plugin is self-contained and works without Loom — the dependency is one-way: Loom reads and orchestrates the plugins, the plugins know nothing about Loom.

Today Loom ships with three layers: **aimux** (AI-CLI accounts and sessions), **Token Pilot** (token savings on code reading), and **Task Journal** (the reasoning behind your work — hypotheses, decisions, findings). The platform is built to grow: new layers slot in as new adapters.

## Install

```bash
npm install -g @digital-threads/loom
loom
```

`loom` with no arguments starts the TUI. Move between tabs with `←` / `→`, quit with `q`. On a clean start the **Catalog** tab is active so you can install plugins right away.

From source (development) — clone the repo, then:

```bash
bun install
bun run build
bun run start
```

## What it shows

- **Overview** — a summary across every active layer.
- **Catalog** — install / remove / update plugins from one place.
- **Tasks & Tokens** — how many tokens a given task cost. Where Loom can tie spend to a task exactly (by a shared session id) it marks it `exact`; where it can only estimate by time, `≈ estimate`.
- **Timeline** — a unified chronology of events across all layers.
- **Config** — `loom config doctor` surfaced in the UI: what's installed, whether external tools are present, config conflicts.
- **Settings** — edit plugin settings (e.g. Token Pilot hook mode and thresholds).
- **Plugins** — manage installed plugins.

Each installed tool (aimux / Token Pilot / Task Journal) also contributes its own tab. If a tool isn't installed, its tab is simply empty and the rest keep working.

## Command line

```bash
loom                                  # start the TUI
loom plugin list                      # what's installed
loom plugin add <source> --yes        # install (npm package, git ref, or local path)
loom plugin remove <name>             # remove
loom plugin detect <name>             # check for an available update
loom pack [--out <file>] [--copy]     # compact workspace context for a fresh AI session
loom config doctor                    # check installs, external tools, config conflicts
loom config merge                     # merge Claude Code config files
```

`loom plugin add` without `--yes` only prints the install plan (what gets copied, which permissions) and changes nothing. `--scope user|project` chooses where to install.

## Workspace pack

`loom pack` builds a compact summary of the whole workspace — the state of every layer — to hand to a new AI session so it doesn't start from zero. Print it, write it to a file (`--out`), or copy it to the clipboard (`--copy`).

## How it works

Everything rests on one contract — `LoomPlugin`. Each tool plugs in through an adapter that implements it; a registry ties them together. The host talks to plugins only through the contract and never touches a plugin's private files — every write goes through the tool's public interface, and irreversible actions ask for confirmation first.

```ts
interface LoomPlugin {
  id: string;
  title: string;
  category: LoomCategory;                          // accounts | efficiency | memory | ...
  tabs: PluginTab[];
  load(ctx: LoomContext): Data | Promise<Data>;    // where the data comes from — hidden inside
  settings?: PluginSettings;
  actions?: PluginAction[];
}
```

The three bundled adapters live in `src/core/plugins/{aimux,token-pilot,task-journal}/` and ship inside `dist/`. aimux is pulled from the registry as a normal dependency; Token Pilot and Task Journal are read where they already store their data, in the context of the current directory.

The one-way rule is the core invariant: plugins have zero dependency on Loom and keep working standalone. Loom is just one consumer of their public interfaces. Exact task↔token correlation works by a shared Claude Code session id that the plugins already emit — Loom joins on it, it does not push any identifier into the tools.

## Stack

TypeScript, [Ink](https://github.com/vadimdemedes/ink) 7 (React in the terminal), Bun for build and run, Vitest for tests. Node ≥ 22.

```bash
bun run build      # tsc + copy plugin manifests into dist/
bunx vitest run    # tests
```
