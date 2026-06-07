# Loom

One terminal screen for three tools that normally live apart: your AI-CLI profiles and sessions (`aimux`), token usage (`token-pilot`), and a task journal with the reasoning behind each decision (`task-journal`). Loom doesn't replace them — it connects to each through its public interface and shows everything side by side, in tabs.

Version `0.0.1` — a working MVP. It's past read-only now: Loom can change settings, run actions, and merge Claude Code config files, not just display data.

## Why

If you run several AI CLIs through `aimux`, track tokens with `token-pilot`, and keep tasks in `task-journal`, that used to mean three separate commands and three different output formats. Loom pulls them into a single panel: at a glance you see which subscriptions are active, how many sessions there are, where the tokens went, and what's happening across your tasks.

Each source is wired in as its own adapter. If a tool isn't installed, its tab is simply empty — the rest keep working.

## What it shows

Six tabs, switch with `←` / `→`, quit with `q`:

- **Overview** — a summary across all plugins at once.
- **Subscriptions** — your `aimux` profiles (which CLI, which model, which source).
- **Sessions** — profile sessions, when they were last used, how many tokens they spent.
- **Tasks** — tasks from `task-journal`: open a task (`Enter`) to see its decisions, findings, and rejected options. From here you can close a task (`c`) or write a token metric into it (`t`) — both ask for confirmation first.
- **Tokens** — usage per session (spent / saved).
- **Settings** — edit plugin settings. Right now `token-pilot` is configurable (hook mode, thresholds, and so on): `↑` / `↓` to pick a field, `Enter` to toggle or enter a value.

## Install and run

From source (works today):

```bash
bun install
bun run build
bun run start      # or: node dist/cli.js
```

For development, without a build step:

```bash
bun run dev
```

As a global `loom` command — once the dependencies are published to npm (`@digital-threads/aimux` is currently a local `file:` dependency; the exact publish order is in [`.docs/loom/publishing.md`](../.docs/loom/publishing.md)):

```bash
npm install -g @digital-threads/loom
loom
loom plugin add @digital-threads/loom-plugin-aimux   # add plugins from npm
```

The repo is a Bun workspace. The host lives at the root; the shared types contract and the three bundled plugins live under `packages/`:

- `@digital-threads/loom-contract` — types-only plugin contract.
- `@digital-threads/loom-plugin-aimux`, `@digital-threads/loom-plugin-token-pilot`, `@digital-threads/loom-plugin-task-journal` — the bundled adapters.

## What you need for the full picture

Loom reads data wherever each tool already stores it. None of this is required — without any one of them Loom still starts, the matching tab is just empty.

- **aimux** — its profile config (the Subscriptions and Sessions tabs). Loom uses the public `@digital-threads/aimux/core` module.
- **token-pilot** — the `.token-pilot/hook-events.jsonl` file in your project root (the Tokens tab) and `.token-pilot.json` for settings.
- **task-journal** — the `task-journal` binary on your `PATH` (the Tasks tab); data comes from `task-journal export`.

Loom works in the context of the current directory (`cwd`) — run it from the root of the project whose data you want to see.

## How Loom writes data

A core principle: Loom never touches a plugin's private files. Every write goes through the tool's public interface only:

- `token-pilot` settings — into its own public `.token-pilot.json`;
- task actions — through the `task-journal` CLI (`close`, `event`, `create`);
- adding a subscription — through the public `aimux/core` API.

Irreversible actions (closing a task, writing a metric) always ask for confirmation.

## Architecture: the plugin contract

Under the hood everything rests on a single contract — `LoomPlugin`. Each tool plugs in through an adapter that implements this contract, and a registry (`loomRegistry`) ties them together. The host talks to plugins only through the contract, without knowing where a given plugin gets its data — an npm module, a file, or a CLI.

```ts
interface LoomPlugin<TData> {
  id: string;
  title: string;
  tabs: PluginTab[];                                  // tabs this plugin contributes
  load(ctx: LoomContext): TData | Promise<TData>;     // where the data comes from — hidden inside
  settings?: PluginSettings;                          // settings schema + read/write
  actions?: PluginAction[];                           // actions (irreversible ones flagged)
}
```

The three plugins map onto it like this:

| Plugin | Data (`load`) | Settings | Actions |
|--------|---------------|----------|---------|
| `aimux` | subscriptions, sessions, profile health | — | add subscription |
| `token-pilot` | token usage | 6 fields (hook mode, etc.) | — |
| `task-journal` | tasks and their events | — | open / close / write metric |

### Adding your own plugin

1. Write an adapter in `src/core/plugins/<name>/adapter.ts` — thin wrappers over your tool's public API or CLI — and export a `plugin: LoomPlugin` object from it.
2. Add it to `createRegistry([...])` in `src/core/plugins/index.ts`. Data and settings are picked up automatically after that.
3. If the plugin returns new data fields, add them to the `WorkspaceData` type (`src/core/data/loader.ts`).
4. Draw the tab: a React component in `src/ui/panels/`, an entry in the tab list in `App.tsx`, and the branch that renders it.

Data, settings, and actions plug in declaratively through the contract — only the tab rendering itself is wired by hand.

## Stack

TypeScript, [Ink](https://github.com/vadimdemedes/ink) (React in the terminal), Bun for build and run, Vitest for tests.

```bash
bun test    # or: bunx vitest run
```
