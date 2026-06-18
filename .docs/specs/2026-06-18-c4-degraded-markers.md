# SDD — C4: Visible "degraded" markers for silent catch{} sites

Date: 2026-06-18 · Scope: **loom-host only**, self-contained · Class: feature

## 1. Problem

Five places swallow a failure into an empty `catch {}` (or log only to the
console). A task can finish **green** while, underneath, something important
silently did not happen — and nobody is told.

| # | Site | File:line | What silently breaks |
|---|------|-----------|----------------------|
| 1 | `recordSessionCost` | `src/web/api.ts:409–417` | session cost not recorded → run looks free |
| 2 | `recordDenials` | `src/web/api.ts:425–432` | denied tools (awaiting approval) lost |
| 3 | `snapshotJournal` | `src/web/api.ts:724–736` | reasoning journal not snapshotted before worktree cleanup |
| 4 | MCP-config write skip | `src/core/automation/aimux-session-launcher.ts:~102` | enabled MCP servers not loaded into the session |
| 5 | `enforcedSettingsPath` write | `src/core/automation/enforced-settings.ts:76–86` | token-pilot enforcement settings not written → session runs without enforced tools (today: logged to console once, but invisible on the task / in the UI) |

## 2. Goal & non-goals

**Goal.** When any of these fail, write a **`degraded` marker on the task**
(naming exactly what degraded) and **show it in the UI** (task card badge + a
section in the History/dossier). Make the silent failure *visible*.

**Non-goals (hard constraints).**
- **Do not change the defensiveness.** No `catch` starts throwing; the task must
  never crash because of this. Marker-writing is itself best-effort.
- No refactor of unrelated code, no new features beyond visibility.
- The existing `console.error`-once behavior in `enforced-settings.ts` stays as
  is — we only *add* a task/UI signal on top.
- Strict DS (`check:ds`); any `fontSize` only via `var(--fs-*)`. UI text English.

## 3. Design

One shape for the marker, reusing the proven artifact pattern already used by
`markNoJournal` / `JOURNAL_STATUS_KIND`.

### 3.1 The marker (host, `src/web/api.ts`)

```
const DEGRADED_KIND = "degraded";   // artifact kind, stage "system"

// Append a degradation reason for a task. Accumulates a deduped list so
// multiple degradations on one task all show. Best-effort (like markNoJournal):
// the visibility mechanism must never itself throw.
const markDegraded = (id: string, what: string): void => {
  try {
    const prev = loadResult<{ reasons?: string[] }>(id, DEGRADED_KIND);
    const reasons = prev?.reasons ?? [];
    if (reasons.includes(what)) return;            // de-dupe — don't pile up
    saveResult(id, "system", DEGRADED_KIND, { reasons: [...reasons, what] });
  } catch { /* best-effort */ }
};
```

Wire it into the three host catch sites — the `catch` bodies stay non-throwing,
we only add one line each:

- `recordSessionCost` catch → `markDegraded(id, "session cost not recorded")`
- `recordDenials` catch → `markDegraded(id, "permission denials not recorded")`
- `snapshotJournal` catch → `markDegraded(id, "journal snapshot failed")`

### 3.2 Core-site degradations → `launcher.degradedOf(sessionId)`

Sites #4 and #5 live in `src/core/...` and do **not** know the loom task id at
the point of failure. They already have a precedent: cost and denials are read
back **after a send** via `launcher.costOf(sid)` / `launcher.denialsOf(sid)`
(`live-session.ts`, `SessionControl`). We add the same shape for degradations.

**`enforced-settings.ts`** — expose the already-tracked write-failure flag
(additive getter, no behavior change):

```
export function enforcedSettingsWriteFailed(): boolean { return warnedWriteFailure; }
```

**`aimux-session-launcher.ts`** — `createAimuxLiveLauncher` keeps a per-session
accumulator and exposes `degradedOf`, composed onto the inner launcher:

```
const degraded = new Map<string, string[]>();
const note = (sid: string, what: string) => {
  const list = degraded.get(sid) ?? [];
  if (!list.includes(what)) { list.push(what); degraded.set(sid, list); }
};
```

Inside `spawnSession`, keyed by `sessionId`:
- MCP write `catch` → `note(sessionId, "MCP servers not loaded (config write failed)")`
- after `enforceFlags()`: if `enforcedSettingsWriteFailed()` → `note(sessionId, "token-pilot enforcement settings not written")`
- if `!tokenPilotOnPath()` → `note(sessionId, "token-pilot not on PATH — session ran without enforced tools")`

Return value gains the reader:

```
const inner = createLiveSessionLauncher({ spawn: spawnSession });
return { ...inner, degradedOf: (sid: string) => degraded.get(sid) ?? [] };
```

The reader is declared on a small additive interface (mirrors `SessionControl`)
so the host depends on the contract, not a duck-typed cast.

### 3.3 Drain core degradations onto the task (host)

At the existing post-send chokepoint (`src/web/api.ts:456–457`, right after
`recordSessionCost` / `recordDenials`), drain the launcher's per-session list:

```
const sid = getTaskSession(db, id).sessionId;          // same lookup the others use
for (const what of sid ? sessionLauncher.degradedOf?.(sid) ?? [] : []) markDegraded(id, what);
```

Wrapped so a failure here is itself best-effort (it must not break the send
path).

### 3.4 Surface in the UI

**Dossier (`src/core/dashboard/dossier.ts`, `renderDossier`).** Add an optional
`degraded?: string[]` field to `DossierInput`; when present, prepend/append a
section so it is impossible to miss:

```
if (degraded && degraded.length) {
  const rows = degraded.map((d) => `- ${d}`).join("\n");
  sections.push(`## ⚠ Degraded\n\n${rows}`);
}
```

Endpoint `/api/tasks/:id/dossier` (`api.ts:1432`) loads the marker and passes it:

```
const degraded = loadResult<{ reasons?: string[] }>(id, DEGRADED_KIND)?.reasons ?? [];
// → renderDossier({ pack, stages, costs, attachments, diff, degraded })
```

**Task card (`web/src/components/TaskView.tsx`).** Show a small `Degraded`
badge when the task has degraded markers, next to the existing History button.
The card needs the data: expose it through whatever the card already consumes
(the task payload / dossier). Concretely:
- add `degraded: string[]` to the task DTO the board endpoint returns (host
  reads the marker via `loadResult`), or surface it on the existing dossier the
  card already fetches;
- render a badge: English label `Degraded`, `title` listing the reasons, styled
  with DS tokens only (`font-size: var(--fs-…)`, existing badge classes). No raw
  px font sizes — `check:ds` must stay green.

The exact card wiring (DTO field vs. dossier-derived) is settled in R&D; the
contract is: **a task with ≥1 degraded reason shows a visible English badge, and
the dossier lists every reason.**

## 4. Files touched

| File | Change |
|------|--------|
| `src/web/api.ts` | `DEGRADED_KIND`, `markDegraded()`; 3 catch sites add one line; drain `degradedOf` after send; dossier endpoint loads + passes `degraded`; board/task DTO exposes degraded for the card |
| `src/core/automation/enforced-settings.ts` | export `enforcedSettingsWriteFailed()` (additive getter) |
| `src/core/automation/aimux-session-launcher.ts` | per-session `degraded` map, `note()`, populate in `spawnSession`, expose `degradedOf` |
| `src/core/dashboard/dossier.ts` | `DossierInput.degraded?`, render `## ⚠ Degraded` section |
| `web/src/components/TaskView.tsx` (+ `web/src/api.ts` DTO if needed) | `Degraded` badge, DS-compliant, English |

## 5. Acceptance criteria

1. Each of the 5 sites, on failure, results in a degraded reason recorded on the
   task — **without** the `catch` throwing (defensiveness unchanged).
2. The dossier for a degraded task contains a `Degraded` section listing every
   reason; a healthy task shows no such section.
3. The task card shows a `Degraded` badge (English) when ≥1 reason exists, with
   the reasons in its tooltip; no badge otherwise.
4. Reasons are deduped (the same failure repeated does not pile up).
5. `check:ds` passes (no raw `fontSize`; `var(--fs-*)` only).
6. Host and web type-check clean: `tsc --noEmit` / `tsc -b --force` (not the
   incremental cache) — both green.
7. New tests cover: `markDegraded` (append + de-dupe), each of the 3 host catch
   sites recording its reason on failure, `degradedOf` populated by the three
   launcher conditions and drained onto the task, and `renderDossier` emitting
   the section. Existing tests (incl. `enforced-settings-write-fail.test.ts`)
   stay green and are not weakened.

## 6. Risks / open questions

- **Enforced-settings is global, not per-session.** `enforcedSettingsWriteFailed()`
  is a process-wide flag, so once HOME is read-only every spawned session is
  correctly flagged degraded. Acceptable — every such session genuinely is
  degraded. (R&D to confirm timing: `ENFORCE_FLAGS` is computed at module load,
  so the write may have already failed before the first session; the per-spawn
  check still catches it because the flag persists.)
- **Card data path** (DTO field vs. dossier-derived) — decided in R&D; either
  satisfies the contract in §3.4.
- Keep scope tight: do not touch the secret-scan / cost-cap logic that sits in
  the same `send` function; only the listed lines.
