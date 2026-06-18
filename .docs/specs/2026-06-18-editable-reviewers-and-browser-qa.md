# SDD — Editable reviewer pipeline + browser QA check cleanup

- **Date:** 2026-06-18
- **Scope:** loom-host only (web UI + host API). Self-contained, additive to shared code.
- **Task journal:** `tj-rnjqy0kt31`

---

## 1. Problem

On the **Quality** view (`web/src/components/Quality.tsx`):

- **QA checks** are real and editable — each check can be toggled on/off and the
  choice is persisted (`saveFlowConfig("qa")` → setting `flow.qa`).
- **The review pipeline** (`self` / `ralph` / `adversarial`) is **hardcoded and
  read-only** (`Quality.tsx:13-17`). The backend also runs a fixed list/order
  (`src/web/api.ts:220-240`, used at `:581-583` and `:1422-1432`).

Two asks:

1. **Part A** — make the reviewers editable the same way QA checks are: enable /
   disable / reorder, persisted via `saveFlowConfig` / `setSetting` under
   `flow.review`, and actually honored by the review runner.
2. **Part B** — verify the `browser` (canary) QA check is wired into the QA
   runner; it is **not**, so wire it or remove it.

## 2. Findings (verified from code)

| # | Fact | Location |
|---|------|----------|
| F1 | Flow-config endpoints are generic per stage. `POST /api/flow-config/:stage` does `setSetting(db, \`flow.${stage}\`, passes)`; `GET` returns `resolveFlow(stage, storedFlow(stage))`. So persisting `flow.review` already works server-side — nothing consumes it for reviews yet. | `src/web/api.ts:1401-1411` |
| F2 | The host review pipeline uses its own `REVIEWERS` (`self`/`ralph`/`adversarial`) + `REVIEWER_KEYS`, fixed order, **not** `resolveFlow("review")` / `runReview`. | `src/web/api.ts:220-240`, `:581-583`, `:1422-1432` |
| F3 | `FLOW_DEFAULTS.review = ["normal","simplify"]` (from `@digital-threads/loom-quality`) — a different concept (generic review passes), unrelated to the host's self/ralph/adversarial reviewers. | `loom-quality/dist/flow-config.js` |
| F4 | `buildQaChecks` returns a **no-op skip** for `key === "browser"`: `skipped("browser checks need a canary connector (not configured)")` → the check always reports `ok:true`. No real canary connector exists in loom-host (`canary` appears only in this file, the UI, and tests). | `src/core/quality/default-qa-checks.ts:82-87` |
| F5 | An existing test pins `GET /api/flow-config/review` → `{passes:["normal","simplify"]}`. | `test/web/api.test.ts:356-359` |
| F6 | A core test feeds `"browser"` to `buildQaChecks` and expects it to be skipped (not fail). | `test/core/quality/default-qa-checks.test.ts:34-43` |

## 3. Decisions

### D1 — Persist reviewers under `flow.review`, host-resolved
Persist the user's reviewer selection (ordered, enabled subset) via the existing
generic `POST /api/flow-config/review` (→ `setSetting(db, "flow.review", keys)`),
exactly like QA. The review runner reads this and runs only the enabled reviewers
in the saved order.

Because the host reviewer keys (`self`/`ralph`/`adversarial`) differ from the
package's generic `review` default (`normal`/`simplify`, F3), the host **does not**
route reviewers through `resolveFlow("review")`. Instead a small host helper
resolves them against the host reviewer catalog.

**Rejected alternatives:** a separate setting key `flow.reviewers` (brief explicitly
says `flow.review`); reusing the generic `GET` as-is for the UI (on a fresh DB it
returns `normal/simplify`, the wrong reviewers).

### D2 — `browser` QA check: remove from the offered options
No canary connector exists in loom-host; wiring one is a separate, sizeable feature
and would violate "self-contained / simplicity". Remove `browser` from the UI
catalog (`QA_OPTIONS`) so users are not offered a check that does nothing.

Leave the core `buildQaChecks` `browser` branch **untouched** — it already skips
gracefully, and core tests depend on that behavior (F6). This keeps the change
additive and the suite green.

**Rejected alternative:** building a real canary integration now (out of scope, not
self-contained).

### D3 — Reviewer "empty → default" mirrors QA
If every reviewer is disabled (saved `passes = []`), the runner falls back to the
full default set — identical to QA's documented "Empty → default" behavior. This is
intentional and symmetric, not a bug.

## 4. Design

### 4.1 Backend (`src/web/api.ts`)

**(a) Reviewer resolver** — add next to `REVIEWER_KEYS`:

```ts
// Reviewers the user enabled, in saved order; empty/unset → all (default).
const resolvedReviewerKeys = (): string[] => {
  const stored = storedFlow("review")?.passes ?? [];
  const valid = stored.filter((k) => REVIEWER_KEYS.includes(k));
  return valid.length ? valid : REVIEWER_KEYS;
};
```

`storedFlow` already returns `undefined` for an empty/absent setting, so the
`?? []` + "empty → all" fallback (D3) holds.

**(b) GET special-case** — host reviewers, not the package resolver:

```ts
app.get("/api/flow-config/:stage", (c) => {
  const stage = c.req.param("stage");
  if (stage === "review") return c.json({ passes: resolvedReviewerKeys() });
  return c.json({ passes: resolveFlow(stage, storedFlow(stage)) });
});
```

POST stays generic (no change) → persists `flow.review`.

**(c) `/review/run` (`:1416-1434`)** — drive the pipeline from the resolved list:
- `const active = resolvedReviewerKeys();`
- explicit reviewer accepted only if `active.includes(body.reviewer)`;
- next-to-run = `active.find((k) => !done.has(k))`;
- "reset" (fresh pipeline) when the chosen key is `active[0]` and nothing done yet;
- `next` in the response = `active.find((k) => !doneSet.has(k)) ?? null`.

**(d) `recordReviewer` (`:256-266`)** — order `reviewersDone` by the active list:
`reviewersDone = active.filter((k) => doneSet.has(k))` (compute `active` inside or
pass it in). Disabled-then-removed keys naturally drop out.

**(e) Autopilot loop (`:579-593`)** — iterate `resolvedReviewerKeys()` instead of
`REVIEWERS` directly:

```ts
const keys = resolvedReviewerKeys();
for (let i = 0; i < keys.length; i++) {
  const reviewer = REVIEWERS.find((r) => r.key === keys[i])!;
  const findings = await runReviewer(id, reviewer);
  payload = recordReviewer(id, reviewer.key, findings, { reset: i === 0 });
}
```

(`reset` on the first **active** reviewer, not on hardcoded `REVIEWERS[0]`.)

### 4.2 Frontend (`web/src/components/Quality.tsx`)

- **Part B:** drop the `browser` entry from `QA_OPTIONS` (leave `tests`, `build`).
- **Part A:** replace the read-only `REVIEWERS` list with an editable control,
  backed by `flow.review`:
  - Keep `REVIEWERS` as the **catalog** (key + label + desc).
  - On mount: `client.flowConfig("review")` → ordered list of enabled keys
    (`reviewers` state), mirroring the existing `qa` state/effect.
  - Render reviewers in saved order: a toggle (✓/○, reuse `btn sm` + `acc` class
    like QA) and **up/down** reorder buttons (also `btn sm`); disabled reviewers
    (catalog keys not in the list) shown after, toggled off.
  - On any change: compute the new ordered-enabled key array and
    `client.saveFlowConfig("review", next)` with the same toast +
    busy-state pattern as `toggle()` (`Quality.tsx:24-31`).
  - Update the heading: drop "(fixed; …)"; add "(click to toggle, reorder)".

**Design-system constraints (must stay green under `npm run check:ds`):** no inline
colors or font-families; `fontSize` only via `var(--fs-*)`; reuse existing classes
(`panel`, `btn sm`, `acc`, `finding-list`, `muted`). UI copy in English.

### 4.3 Data / API contract

| Method | Path | Body | Returns | Change |
|--------|------|------|---------|--------|
| GET | `/api/flow-config/review` | — | `{ passes: string[] }` (enabled reviewer keys, ordered) | **changed** (host-resolved) |
| POST | `/api/flow-config/review` | `{ passes: string[] }` | `{ ok: true }` | unchanged (generic) |
| GET/POST | `/api/flow-config/qa` | — | as before | unchanged |

No DB schema change — reuses the key/value `setSetting`/`getSetting` store under
`flow.review`.

## 5. Test plan (TDD where testable)

Backend (`test/web/api.test.ts`, vitest):

1. **Update F5 assertion** — `GET /api/flow-config/review` on a fresh DB now
   returns `{ passes: ["self","ralph","adversarial"] }` (host default). This is the
   only existing test that changes, and it reflects the intended new behavior.
2. **Persist + readback** — `POST /api/flow-config/review {passes:["adversarial","self"]}`
   then `GET` returns the same ordered subset.
3. **`/review/run` honors order/subset** — with `["adversarial"]` persisted,
   the first (and only) reviewer run is `adversarial`; `next` is `null` after it.
4. **Empty → default (D3)** — `POST {passes:[]}` then `GET` returns all three.
5. **Autopilot honors the subset** — autopilot run with a 1-reviewer subset runs
   only that reviewer (assert via injected reviewer deps / recorded turns).

Core: **no new/changed core tests** — `buildQaChecks` and `default-qa-checks.test.ts`
(F6) are untouched.

Frontend: no React test harness exists for `web/` components, so the UI is verified
by `web` `tsc`, `npm run check:ds`, and manual click-through (toggle, reorder, save,
reload → persisted; `browser` no longer listed under QA). Logic that can be unit
tested lives in the backend resolver above.

## 6. Acceptance criteria

- [ ] Reviewers can be enabled/disabled and reordered in the Quality view; the
      choice persists across reload (via `flow.review`).
- [ ] `/review/run` and autopilot run exactly the enabled reviewers, in saved order.
- [ ] Disabling all reviewers falls back to the default set (documented, symmetric
      with QA).
- [ ] `browser` is no longer offered as a QA check in the UI; `tests` / `build`
      still work and persist.
- [ ] Core `buildQaChecks` and its tests unchanged; full suite green.
- [ ] `npm run check:ds` green; no inline colors/fonts; `fontSize` only
      `var(--fs-*)`; UI copy English.
- [ ] `web` and host `tsc` green.

## 7. Risks & open questions

- **R1 (handled):** the `review` stage name collides between the package's generic
  passes (`normal/simplify`) and the host reviewers (`self/ralph/adversarial`). The
  host GET special-case (D1) keeps these separate; only the one assertion in F5 is
  updated.
- **R2:** if any other host code starts relying on `resolveFlow("review")` later, it
  will still get `normal/simplify` — unaffected by this change (host reviewers use
  the dedicated resolver). No such consumer exists today.
- **R3:** persisting an empty list cannot express "run zero reviewers" (it means
  default). Accepted, matches QA. If a true "none" state is ever needed, it would
  require a sentinel — out of scope here.
