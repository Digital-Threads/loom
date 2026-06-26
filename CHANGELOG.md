# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.7.1] - 2026-06-26

### Fixed

- **Account authorization works on macOS** — the in-UI "Authorize" used
  Linux-only `script` flags, so on a Mac it ended with "authorization did not
  complete". The invocation is now platform-correct (BSD form on darwin).
- **An auth failure offers re-authorize / switch** — a 401 / invalid-credentials
  error now shows an account banner (re-authorize or switch account), like a rate
  limit, instead of a silent "degraded" park.
- **No false "switch subscription" prompt** — the rate-limit detector matched bare
  "rate limit" / "429" / "too many requests" in the agent's own output (e.g. an
  analysis discussing HTTP codes), popping a switch prompt at low usage. Narrowed
  to the provider's actual block phrasing.
- **Onboarding installs cleanly** — task-journal's marketplace used a `github:`
  prefix the CLI rejects (now an `https://` URL); a plugin "update" at the wrong
  scope no longer fails the whole install (best-effort).

### Changed

- **Readable system log** — each tool burst is labelled with a human action
  (📖 Reading code / 🧪 Running tests / ✏️ Editing files / 🔍 Searching …), with the
  raw tool name kept beside it; the analysis stage is steered to token-pilot
  exploration instead of raw recursive `find`/`grep`.

## [0.7.0] - 2026-06-26

### Added

- **Ultracode raises reasoning effort** — an ultracode task now runs its agent
  sessions at `--effort xhigh` (the heavier-reasoning half of the mode), threaded
  through the whole pipeline: the main stage lanes, the spec swarm, and the impl
  swarm. A normal task uses the CLI default. Requires aimux ≥ 0.18 (which exposes
  the per-session effort flag) — loom-34th / loom-daeq.
- **Ultracode (preview)** — a per-task toggle at creation that opts a big task into
  fan-out: the hard stages (spec + implementation) run as a swarm of candidates and
  a judge picks the best, even when the global swarm toggles are off. Shown as an
  ⚡ badge on the task. Autopilot only, N× the cost; the cost cap still applies.
  Heavier reasoning (effort) for ultracode tasks is tracked separately (loom-34th).
- **Spec stage as a swarm (preview)** — the spec stage can draft several candidate
  SDDs in parallel (each through a different lens) and let a judge elect the best,
  the same "ask for N approaches, pick the winner" idea as the implementation
  swarm but for the design doc. Off by default, autopilot only, N× the cost;
  configured per-stage on the Swarm page next to the impl swarm (loom-dmha).
- **One-line binary installer** — `curl -fsSL …/install.sh | sh` downloads the
  latest self-contained binary for your platform (Linux x64, macOS Apple
  Silicon), unpacks it with the web UI beside it, and puts `loom` on your PATH —
  no Node required. The README now documents both install paths (npm and binary).

### Fixed

- **Impl-swarm winner always gets the full QA safety net** — swarm candidates are
  gated only on `build` (the test suite is fragile in a worktree), with the full
  suite meant to run in the QA stage after the winner is promoted. But a chore
  route skips QA, so a swarm-elected chore was never fully tested. Now, when a
  swarm promotes a winner, QA is forced back into the route — the promoted change
  is always verified by the full suite (loom-287h).
- **PRs no longer reimplement already-merged work** — before opening (or pushing)
  a PR, Loom now fetches `origin` and rebases the task branch onto the *live* base
  (`origin/master`), not a stale local copy. A task that branched off an older
  master and redid work merged during the run now surfaces as a rebase conflict
  and parks for a human, instead of producing a redundant/conflicting PR
  (loom-bovz).
- **Clearer "mentioned file" chips** — the 📄 chips under a turn are file paths
  the agent *mentioned*, not necessarily files it changed. Clicking one that isn't
  in the task's working tree (e.g. a path quoted from another project during
  analysis) now shows "mentioned but not in the task's tree" instead of a raw 404.

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

[Unreleased]: https://github.com/Digital-Threads/loom/compare/v0.7.1...master
[0.7.1]: https://github.com/Digital-Threads/loom/releases/tag/v0.7.1
[0.7.0]: https://github.com/Digital-Threads/loom/releases/tag/v0.7.0
[0.6.0]: https://github.com/Digital-Threads/loom/releases/tag/v0.6.0
[0.5.0]: https://github.com/Digital-Threads/loom/releases/tag/v0.5.0
