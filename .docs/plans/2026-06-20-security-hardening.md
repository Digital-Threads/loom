# Security layer — production hardening (2026-06-20)

Goal: close the gap between Loom's current "soft" security posture and a
production-grade one, with the explicit decisions taken on 2026-06-20.

## Decisions (locked)

- **Sandbox backend:** bubblewrap on Linux/WSL2; `sandbox-exec` best-effort on
  macOS; `none` + a **loud** degraded marker on Windows/anything without a backend.
- **Autopilot:** sandbox **ON by default**. If a backend is unavailable, mark the
  task `degraded` and run anyway (do NOT hard-block).
- **Network egress:** deferred to v2 (documented gap + backlog issue). Net stays
  shared so the Anthropic API + package installs keep working.

## Current state (verified)

- ✅ Works: command-policy PreToolUse(Bash) hook (DEFAULT_DENY floor + user
  allow/deny), secret scanning every turn (secure-executor), worktree isolation,
  path-safety (UI file serving), audit bus.
- ⚠ Plumbed but inert: OS sandbox. `wrapCommand` (os-sandbox.ts:41, bubblewrap/
  sandbox-exec) is wired through the launcher's `spawnFn`
  (aimux-session-launcher.ts:108-117) but: off by default (api.ts:315), and
  **autopilot explicitly bypasses it** (conductor.ts:70-71). Unproven at runtime:
  `--ro-bind / /` makes `~/.claude` read-only → likely breaks `--resume`.
- ☠ Dead code: `mode.ts` `evaluateCommand`/enforce-mode — referenced only in
  tests.

## Milestones

### M1 — Make the OS sandbox real on every path, ON for autopilot (highest value)
1. `sandbox.enabled` default stays user-controlled for interactive, but autopilot
   resolves sandbox = ON regardless of the toggle (a task's run_mode is known at
   launch). Wire the sandbox resolver so the autopilot path is gated (remove the
   conductor.ts:70-71 carve-out).
2. Fix the bubblewrap bind set in `os-sandbox.ts`: writable = the task worktree +
   `~/.claude` (and the active aimux CLAUDE_CONFIG_DIR) + `/tmp` + a per-task
   tmpdir; read-only = the rest of `/`. Keep `--share-net` (egress deferred).
   This is the *unproven* part — validate at runtime on WSL2 before trusting.
3. When `detectSandbox()` returns `none` on a sandbox-requested launch, record a
   visible `degraded` marker on the task ("OS sandbox unavailable — install
   bubblewrap") instead of silently passing through.
4. Integration test: assert the launcher spawns `bwrap … claude …` when sandbox is
   on (injected spawnFn captures argv), and passes through when off/none.

### M2 — Audit completeness from the live hook
The .cjs command hook denies silently to Claude; Loom's `command.blocked` counter
stays 0. Have the hook append a JSONL line (`~/.loom/audit/<taskId>.jsonl`) on a
block; Loom tails it and re-emits `audit.command.blocked` onto the bus so the
Security timeline reflects real blocks.

### M3 — Secret redaction on the live stream + git artifacts
`secure-executor` redacts the batch executor's stdio, but the live session stream
(launcher `onChunk`) and generated PR bodies/commit messages are not scanned. Run
`redactSecrets` over the live chunk sink and over the PR description before it is
stored/pushed.

### M4 — Enforce-mode + resource limits (smaller)
- Apply `runWithLimits` (wall-clock) + bubblewrap-level limits to the *live* spawn,
  not just the batch executor.
- Wire the soft/enforce distinction so autopilot runs in `enforce` (deny wins,
  surfaced) — folding path-jail into the hook, retiring `mode.ts` dead code or
  using it.

### v2 (deferred, issue filed)
- Network egress allowlist (netns/proxy: Anthropic API + npm/pip).
- Docker/container backend (sandbox-backend.ts bookmark).

## Test strategy
Pure logic already covered. Add: launcher integration (spawn argv with/without
sandbox), degraded marker on `none`, hook→audit JSONL round-trip, live-stream
redaction. Each milestone ships independently behind the existing toggle.
