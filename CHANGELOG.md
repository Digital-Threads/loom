# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.5.0] - 2026-06-20

### Added

- **Self-contained binary** — `npm run compile` produces a single executable
  (`release/loom`) that runs the full app — API, web UI, database — with no
  Node, no npm, and no dependency tree to install.
- **Cross-platform release build** — pushing a `v*` tag builds the binary for
  Linux, macOS, and Windows and attaches each to the GitHub Release.
- **Implementation swarm (preview)** — the implementation stage can run several
  candidate solutions in parallel and let a judge promote the best one. Off by
  default; autopilot only.
- **Russian UI** — the whole web interface is translated; the language follows
  the interface-language setting.
- **Auto-fallback on rate limit** — when no replacement account is picked
  manually, Loom automatically moves the task to a healthy subscription after
  a short grace window.

### Fixed

- **One run per task** — a double-click, a second tab, or a racing client can
  no longer start two stages at once and leave the board in a corrupt state
  (e.g. two stages both showing "active").
- **Board declutter** — removed the per-column model picker from the board
  headers; the model is still set per task and by the per-stage default.
- **Rate-limit recovery** — when an account hits its usage limit, the task
  continues the *same* session on another account that still has headroom;
  when no account is free, the task is parked honestly instead of pretending
  to switch.
- **Reliable Stop** — stopping an agent is final and never auto-resumes;
  restarting is always an explicit action.
- **File viewer returns 404 instead of 403** — requesting a missing in-tree
  file now responds with "not found" rather than a misleading "forbidden".
- **Host-agnostic PR link** — the PR stage pushes the branch and returns a
  PR/MR link without assuming a specific git host.
- **Task-journal availability** — every session reaches task-journal, so
  reasoning-chain events are recorded; confirmed working end-to-end.

[Unreleased]: https://github.com/Digital-Threads/loom/compare/v0.5.0...master
[0.5.0]: https://github.com/Digital-Threads/loom/releases/tag/v0.5.0
