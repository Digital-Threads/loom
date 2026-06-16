# Cross-project board (one board, many projects)

## Goal
One kanban board holding tasks from **all** projects. Each task is tagged with
its project; the board has a **project filter** (All / a project). When a filter
is set, a new task defaults to that project (changeable in the form). Projects
are added manually or auto-registered when a task is created in a new repo.
Projects tab becomes a dashboard: per-project task count + tokens used/saved.

NOT switching the board per project (rejected) — the board is cross-project.

## Model
- Single task store (the server's existing db) gains `tasks.project_id`.
- A task's project = its `project_id` → registry (`~/.loom/projects.json`) for
  name + root. Backfill existing tasks to the current project id.
- `active` project stays only as: default for new tasks + scope for
  Accounts/Tokens/Memory. No board switching.

## Phase A — task ↔ project + board filter
1. DB: `tasks.project_id TEXT` (schema + ENSURE_COLUMNS; backfill = current
   project). `createTask` accepts `projectId`; add `setTaskProject` (future).
2. Engine: `BoardCard.projectId` (from `t.project_id`).
3. Create endpoint: resolve project from the chosen repo — find registry entry
   by root, else **auto-add** (`addProject(repo)`) — and store its `projectId`.
4. Web Board: fetch projects → project chip on each card; a **project filter**
   dropdown (All / each project); filter cards client-side.
5. NewTaskModal: when a board filter is active, default repo/project to it.
6. TaskView rail: show project **name** (not the repo path).

## Phase B — Projects dashboard + auto-add polish
- `GET /api/projects/stats` → `[{projectId, name, root, tasks, used, saved}]`:
  tasks = count of tasks with that project_id; used/saved = sum of
  `tokenUsageBySession(root)`.
- Projects tab: cards/table with those stats. Add (manual) stays; drop "Switch"
  (no board switch) — keep a quiet "default for new tasks" marker.

## Verify
TDD on project_id store + create routing; Playwright screenshot of the board
filter + project chips + Projects dashboard.
