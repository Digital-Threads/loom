# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Auto-fallback on rate limit** — when no replacement account is picked
  manually, Loom automatically moves the task to a healthy subscription after
  a short grace window.

### Fixed

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

[Unreleased]: https://github.com/Digital-Threads/loom/commits/master
