# Loom

> 🧪 **Public beta.** Loom is early and under active development — expect rough
> edges, and please [report what breaks](https://github.com/Digital-Threads/loom/issues).
> Thanks for testing it.

**Give Loom a task; it runs that task through a real engineering pipeline — analysis → brainstorm → spec → plan → code → review → QA → PR — driving an AI agent through every stage in an isolated sandbox, and shows the whole thing on a board.** You watch, or let it run on autopilot and review the PR it produces.

Under the board, Loom is also a local control center for the AI-development tools that normally live apart: install plugins and MCP servers from one place, see every layer on one dashboard, and manage them in-app. Each layer is self-contained and works without Loom — the dependency is one-way: Loom reads and orchestrates the layers, the layers know nothing about Loom.

The layers: **aimux** (multi-account AI-CLI sessions, no downtime on rate limits), **Token Pilot** (60–80% token savings on code reading), **Task Journal** (the reasoning behind your work — decisions, rejections, findings), plus the built-in **Knowledge / Swarm / Quality / Security** layers (folded into the core). New layers slot in as new adapters.

## Install

Two ways to get Loom. Use npm if you already have Node; use the binary if you
don't want a toolchain.

### npm (needs Node ≥ 22)

```bash
npm i -g @digital-threads/loom
loom
```

Easiest to update (`npm i -g @digital-threads/loom@latest`) and the right choice
on a machine that already has [Node.js](https://nodejs.org).

### Binary (no Node, nothing to install)

```bash
curl -fsSL https://raw.githubusercontent.com/Digital-Threads/loom/master/loom-host/install.sh | sh
loom
```

Self-contained — the runtime and the web UI are bundled into one executable, so
there's no Node and no dependency tree. The installer grabs the latest release
for your platform (Linux x64, macOS Apple Silicon) and puts `loom` on your PATH;
on Windows, or another architecture, download the archive from the
[releases page](https://github.com/Digital-Threads/loom/releases/latest) or use
the npm install above. Updating means re-running the installer.

`loom` with no arguments starts the app — the local API and the web UI — and
opens the dashboard in your browser. Stop it with `Ctrl+C`.

**First run sets itself up.** The onboarding screen checks your prerequisites
(the `claude` CLI, `cargo`) and offers a one-click **Install missing** that pulls
in the rest — Token Pilot and Task Journal (and `cargo`/Rust if needed) — so you
don't have to install dependencies by hand.

Flags:

```bash
loom serve --port 4400             # listen on a specific port
loom serve --no-open               # start without opening a browser
loom serve --project /path/to/repo # run against another project directory
```

From source (development) — clone the repo, then:

```bash
npm install
npm run build
npm start
```

## What it shows

- **Board** — your tasks as pipeline stages. Drag a card onto a stage to run it; cards show live status (running / waiting / done / failed) and project.
- **Memory** — the readable story of each task: what it was, what was decided and why, what was verified, and the real **cost in $** plus the **$ saved** by Token Pilot.
- **Connectors** — install Claude plugins and MCP servers, and import issues from a tracker (beads / GitHub) into board tasks.
- **Knowledge / Skills / Layers** — recall prior reasoning; a library of agent skills; the catalog of layers and their status.
- **Accounts / Tokens** — subscriptions and rate limits; token usage and savings, attributed per task and per account (marked `exact` when tied to a session id, `≈ estimate` otherwise).
- **Security / Quality / Swarm** — command policy + secret-scan + audit; configurable Review/QA runners; multi-attempt coordination.
- **Timeline / Settings / Projects** — a unified event chronology; settings; multi-project management.

Each layer is self-contained: if a tool isn't installed, its section is simply empty and the rest keep working.

## Command line

```bash
loom                                  # start the app (API + web UI), opens the browser
loom serve [--port N] [--no-open] [--project <dir>]
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

## Reliability

- **Rate-limit recovery** — when a subscription hits its usage limit, Loom switches the task to another account that still has headroom and continues the *same* session there, so no context is lost. If you don't pick a replacement yourself, an auto-fallback does it after a short grace window; when no account has headroom, the task is parked honestly instead of pretending to switch.
- **Stop** — stops the agent reliably and never resumes it automatically; restarting is always an explicit action.

## Stack

TypeScript, [Ink](https://github.com/vadimdemedes/ink) 7 (React in the terminal), Node ≥ 22 for build and run, Vitest for tests.

```bash
npm run build      # check:ds + tsc + build web + copy plugin manifests into dist/
npx vitest run     # tests
```

## Publishing (maintainers)

The full release map — every package and plugin, which registry it goes to
(npm / crates.io / Claude marketplace), its version, the exact publish command,
and the dependency-correct order — lives in **[PUBLISHING.md](./PUBLISHING.md)**.

In short: the knowledge / swarm / quality / security layers are **built into the
core** (`src/core/layers/`), so the only sibling dependency is `@digital-threads/aimux`
(`file:../` locally). `prepack` swaps that to its registry version for the tarball
and `postpack` restores it. **`npm publish` from `loom-host`** (not `bun publish`),
since the swap relies on the `prepack`/`postpack` hooks.
