# @digital-threads/loom-plugin-token-pilot

A [Loom](https://github.com/Digital-Threads/loom) plugin that wraps **Token Pilot** — token-usage tracking for AI coding sessions.

## What it shows in Loom

- A **Tokens** tab with usage per session (spent / saved).
- **Settings** for Token Pilot: hook mode, thresholds, and the other knobs, editable from Loom's Settings tab.

The plugin reads usage from `.token-pilot/hook-events.jsonl` in your project root and reads/writes settings through Token Pilot's own public `.token-pilot.json` — it never touches private state.

## Requirements

Token Pilot must be set up in the project (so that `.token-pilot/hook-events.jsonl` and `.token-pilot.json` exist). Without it the tab is empty and the rest of Loom keeps working.

## Install

This plugin ships with Loom out of the box. To add it to a Loom install as an external plugin:

```bash
loom plugin add @digital-threads/loom-plugin-token-pilot
```

Once installed, Loom discovers it through its `plugin.json` manifest (`entry` → `./dist/adapter.js`) and registers the exported `plugin`.

## License

MIT
