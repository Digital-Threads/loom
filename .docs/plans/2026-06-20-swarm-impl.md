# Swarm layer — full implementation (2026-06-20)

Goal: wire the existing swarm engine into the pipeline as a real, opt-in feature,
including **impl-as-swarm** (the hard case), per the 2026-06-20 decision.

## Decisions (locked)

- **Scope:** full — including impl-as-swarm (N isolated worktrees + a judge agent).
- **Attempt variation:** `perspectives[]` (already in SwarmConfig) — same model.
- **Winner for code:** objective gate first (run the QA checks / build+tests per
  attempt, drop the red ones), then a **judge agent** elects among green survivors.
  Discrete stages (analysis/review) keep `majorityVote`.
- **Worktrees:** read-only stages share one worktree; code stages get one
  isolated worktree per attempt.
- **Cost:** low default N=3, hard per-stage cap (5), per-run USD budget guard that
  aborts further attempts; per-attempt cost emitted in `swarm.*` metrics.
- **Opt-in:** per-stage flow-config flag (`flow.swarm.<stage>` or a swarm config),
  with a global default — mirrors the Review reviewer flow.

## Current state (verified)

- ✅ Engine: `runSwarmStep` (swarm-step.ts), `runConcurrent`/`majorityVote`/
  `successes` (coordinator.ts) — clean, tested. Duplicated in core/swarm + core/
  layers/swarm (de-dup as part of this work).
- ✅ run-manager: `parentRunId` + `childrenOf` + `RunContext.emit` (the fan-out
  seam) exist.
- ✗ Nothing imports swarm; no attempt-spawn, no N-worktree alloc, no judge, no
  `swarm.*` emission, no cost accounting, no API/UI launch. ~95% unbuilt.

## Milestones

### M1 — Spine + config foundation (small, low risk)
1. De-duplicate the two engine copies → one home (`core/layers/swarm`).
2. Swarm flow-config resolver: `swarmConfigFor(stage)` from settings
   (`swarm.<stage>.{enabled,attempts,perspectives}`) + global default, validated
   (attempts clamped 1..5). Replaces the orphan `swarm.attempts`.
3. `swarm.*` spine events with `{ attempts, survivors, winner, cost }` metrics +
   per-attempt cost capture. The event shape already supports it.

### M2 — Discrete swarm (analysis/review) — first shippable
- Attempt fn = spawn a child run (`run-manager.start({ parentRunId })`) with a
  fresh session + the stage prompt + a perspective suffix; shared read-only
  worktree. Collect via `childrenOf`, elect with `majorityVote` (review = union of
  findings). Emit `swarm.*`. Wire into the stage runner behind the flow flag.

### M3 — impl-as-swarm (the hard case)
- Allocate N isolated worktrees (generalize ensureWorktree 1→N: `loom/<id>/sw<k>`).
- N attempts each implement in their own worktree with a distinct perspective.
- Objective gate: run the task's QA checks (tests/build) per attempt; drop reds.
- Judge agent: reads the green attempts' diffs + reports, elects one (or requests
  a merge), returns the winning attempt id + rationale. Promote that worktree's
  branch as the task's result; discard the others.
- Budget guard: stop launching attempts once the per-run USD budget is hit.

### M4 — UI
- Per-stage swarm toggle + N + perspectives in Quality/Settings (like reviewers).
- Swarm.tsx: drop the preview banner once M2 lands; the runs log fills from
  `swarm.*` events (already wired in the UI).

## Riskiest parts
1. Judge for code (no objective vote) — mitigate with test/build gate first.
2. Cost blow-up — budget guard + low cap from day one.
3. N concurrent sessions/worktrees: isolation + cleanup (orphan claude procs).
4. Partial failure: if all attempts fail/red → fall back to a single normal run,
   not a dead stage.

## Test strategy
Engine already tested. Add: config resolver, attempt-spawn (injected launcher),
fan-in election, N-worktree alloc/cleanup, judge output parsing, budget-guard
abort, `swarm.*` emission, and the single-run fallback.
