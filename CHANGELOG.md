# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **One-line binary installer** — `curl -fsSL …/install.sh | sh` downloads the
  latest self-contained binary for your platform (Linux x64, macOS Apple
  Silicon), unpacks it with the web UI beside it, and puts `loom` on your PATH —
  no Node required. The README now documents both install paths (npm and binary).

### Fixed

- **PRs no longer reimplement already-merged work** — before opening (or pushing)
  a PR, Loom now fetches `origin` and rebases the task branch onto the *live* base
  (`origin/master`), not a stale local copy. A task that branched off an older
  master and redid work merged during the run now surfaces as a rebase conflict
  and parks for a human, instead of producing a redundant/conflicting PR
  (loom-bovz).

## [0.6.0] - 2026-06-22

### Added

- **Network egress allowlist** — a task's agent can be confined to a set of
  allowed hosts; anything off the list is refused. Off by default: first you
  **observe** (the agent's outbound hosts are logged and shown in the Security
  panel's Egress tab), then you turn on enforcement with a toggle and a hosts
  editor (defaults cover the model API, npm, GitHub, PyPI). Fails closed — if the
  filtering proxy can't start while enforcement is on, the agent gets no network
  rather than open network.
- **Provider presets** — add DeepSeek, GLM, Kimi, Qwen, MiniMax, or MiMo as a
  one-token profile from Accounts → "Add provider". They run on the Claude CLI
  against the provider's Anthropic-compatible endpoint, so they keep the full
  toolset and resume natively; pick a provider per task from the task's account
  selector.

### Changed

- **aimux 0.17** — provider presets and the cross-CLI handoff.

### Fixed

- **token-pilot allowed by default** (gated/manual) — the agent no longer needs
  approval to use the token-efficient tools it's instructed to use.
- **Retired the dead command-mode** — an old soft/enforce check that was never
  wired; the OS sandbox plus the command policy are the real enforcement.
- **Per-stage model for non-Claude profiles** — a Codex/GLM profile runs its own
  model instead of being handed a Claude tier.

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

[Unreleased]: https://github.com/Digital-Threads/loom/compare/v0.6.0...master
[0.6.0]: https://github.com/Digital-Threads/loom/releases/tag/v0.6.0
[0.5.0]: https://github.com/Digital-Threads/loom/releases/tag/v0.5.0
