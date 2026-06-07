# @digital-threads/loom-plugin-task-journal

A [Loom](https://github.com/Digital-Threads/loom) plugin that wraps **Task Journal** — the append-only log of tasks and the reasoning behind each decision.

## What it shows in Loom

- A **Tasks** tab listing tasks from Task Journal. Open a task to see its decisions, findings, and rejected options.
- Actions: **open a task**, **close a task**, and **write a token metric** into a task. Irreversible actions ask for confirmation first.

All writes go through the `task-journal` CLI (`create`, `close`, `event`) — the plugin never edits the journal files directly.

## Requirements

The `task-journal` binary must be on your `PATH`. Data is read via `task-journal export`. Without the binary the tab is empty and the rest of Loom keeps working.

## Install

This plugin ships with Loom out of the box. To add it to a Loom install as an external plugin:

```bash
loom plugin add @digital-threads/loom-plugin-task-journal
```

Once installed, Loom discovers it through its `plugin.json` manifest (`entry` → `./dist/adapter.js`) and registers the exported `plugin`.

## License

MIT
