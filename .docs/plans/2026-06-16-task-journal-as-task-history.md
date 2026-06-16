# task-journal = the self-contained, ideal task history

## The reframing (user)
task-journal must be perfect **on its own** — it IS the full story of a task
(goal/problem/bug → analysis → variants → choices → rejections → discovered
problems → artifacts/PR). Loom is a thin consumer. The substance lives in tj.

## Ground truth (from `task-journal pack`)
tj ALREADY renders a structured dossier and already captures most of it:
- `# Title [status]` + **Goal** + **Outcome[tag]**
- **Artifacts**: commits, files, **PR urls** — auto-extracted (`artifacts.rs`)
- **Active decisions** (with **alternatives**), **Rejected**, **Evidence**,
  **Lifecycle**, **Subtasks**, **External** link.
The model + render are ~80% of the goal already.

## The two real failures
1. **Loom ignores tj's pack.** Memory renders its own raw filter
   (`taskDetailFromEvents`) instead of `task_pack` → unreadable.
2. **Data quality in tj is poor.** decisions are polluted with compaction
   summaries ("This session is being continued…"), duplicates, multi-paragraph
   essays — so even the good structure looks like noise.

## Plan (tj-centric)

### Phase 1 — task-journal repo (additive, PR, backward-compatible, tested)
Make tj's OWN output ideal:
- **Clean pack**: filter compaction/noise events and de-duplicate (drop
  "Conversation compacted…", "This session is being continued…", repeated text)
  so decisions/evidence read crisp. New mode or default-on with opt-out.
- **Artifacts section**: ensure commits / files / **PR urls** render as a clean
  dedicated block (already extracted — surface consistently).
- (optional) **auto-bind**: when `LOOM_TASK_ID` is set, MCP `event_add`/`task_create`
  resolve the task with `external = LOOM_TASK_ID` (create-if-missing) so the
  agent's reasoning auto-lands on the right task. Env-gated; without it, tj is
  unchanged. This realizes the spine.
- All changes additive + covered by tj's own tests; nothing breaks for its users.

### Phase 2 — recording discipline
The pipeline agent records CRISP entries: decision (short + alternatives),
finding, rejection — not essays. Tighten the session preamble; rely on tj's
event types. (No new storage — quality of input.)

### Phase 3 — Loom renders tj's pack
- Loom Memory / task "History" tab renders **`task_pack`** output (the readable
  dossier), NOT the homegrown raw filter. Link board → tj via `external`.
- Per board task: show its tj dossier (goal/decisions+alternatives/rejected/
  evidence/artifacts/PR/lifecycle) + the Loom artifacts it already stores.

## Backward compatibility
tj stays standalone: every tj change is additive (new pack mode / env-gated
auto-bind); default behavior for existing tj users is unchanged. Loom only
consumes tj output.

## Verify
tj: unit tests for clean-pack filtering + auto-bind. Loom: render the pack;
Playwright screenshot of the readable task History.
