# Per-task profile + mid-session subscription switching

## Goal
A task runs under a chosen aimux profile (subscription), and the user can switch
the subscription **mid-session** — the same Claude conversation continues under a
different account via `--resume`. When a profile nears its rate limit, warn and
offer a switch (with a countdown auto-fallback).

## Model (the key insight)
- `sessionId` is **stable** — the conversation identity, never changes.
- `profile` is a **mutable pointer** — "which subscription this session runs under now".
- `aimux run <profile> --resume <sessionId>` works **cross-profile** → this is what
  makes switching possible without losing the conversation.

## Hybrid: reuse aimux core, orchestrate in Loom
| Piece | Owner |
|---|---|
| Rate-limit detection (5h/7d %, reset) | aimux `fetchRateLimits` / `classifyProfile` |
| Active profile, run params | aimux `loadActiveProfile`, `buildRunParams` |
| task ↔ session ↔ **current_profile** | Loom (DB) |
| Switch orchestration (stop → resume → "Continue") | Loom live-session launcher |
| Selector / switch control / countdown modal | Loom web |

## DB
`tasks.profile TEXT` — mutable current profile (ENSURE_COLUMNS auto-migrate +
CREATE_TABLES). Set at creation (default = active), `UPDATE` on every switch.
Persisted because a session outlives the page/process (same class as the
runId-lost bug). No immutable id; no separate table for Phase A.

## Phase A — choose + manual switch
1. DB: `profile` column + `setTaskProfile(db,id,profile)` + `CreateTaskInput.profile`.
2. Thread profile per-run: `SessionLauncher.run` opts → `SpawnSession` → launcher
   uses `opts.profile ?? loadActiveProfile() ?? first`. `sessionSend` passes
   `getTask(id).profile`.
3. Create endpoint accepts `profile`; NewTaskModal adds a profile `<select>`
   (default = active, options = subscriptions).
4. Switch endpoint `POST /api/tasks/:id/switch-profile {profile}`:
   `launcher.stop(sessionId)` → `setTaskProfile` → relaunch `--resume` + send a
   "Continue" prompt (streams to transcript). TaskView shows current profile +
   a switch control.

## Phase B — limit-aware auto-switch (unblocked by aimux)
- Poll `fetchRateLimits(profile)` for the active task's profile; expose % in UI
  (ProfilesStatusBar-style).
- Threshold (5h ≥ ~90% or status=limited) → countdown modal (profile picker +
  30s). On choice/timeout (next healthy profile) → call the switch endpoint.

## Verify
TDD on the pure/threading bits; live Playwright screenshot of the selector +
switch; confirm `--resume` continues the conversation under the new profile.
