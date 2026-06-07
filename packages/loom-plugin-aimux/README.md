# @digital-threads/loom-plugin-aimux

A [Loom](https://github.com/Digital-Threads/loom) plugin that wraps [aimux](https://github.com/Digital-Threads/aimux) — your AI-CLI profile and session manager.

## What it shows in Loom

- **Subscriptions** — your aimux profiles: which CLI, which model, which one is the source.
- **Sessions** — profile sessions with last-used time and token spend.
- An **Add subscription** action.

Data and writes go only through aimux's public `@digital-threads/aimux/core` module — the plugin never touches aimux's private files.

## Requirements

You need aimux itself: this plugin depends on `@digital-threads/aimux`. If aimux isn't configured, the tabs are simply empty and the rest of Loom keeps working.

## Install

This plugin ships with Loom out of the box. To add it to a Loom install as an external plugin:

```bash
loom plugin add @digital-threads/loom-plugin-aimux
```

Once installed, Loom discovers it through its `plugin.json` manifest (`entry` → `./dist/adapter.js`) and registers the exported `plugin`.

## License

MIT
