# SDD — Security panel: policy configuration

- **Date:** 2026-06-18
- **Task:** loom t-429a1b36
- **Status:** spec
- **Scope:** loom-host only, self-contained, additive to shared code.

## 1. Problem & goal

The **Security** tab (`web/src/components/Security.tsx`) is observation-only today:
an OS-sandbox toggle plus a filterable audit trail. The security policy itself
(which commands are blocked, which secret patterns are scanned, whether scanning
runs at all) is invisible and unconfigurable.

**Goal:** turn the panel into a configuration surface, on **real data from the
security layer**:

1. **Command policy** — view the built-in deny defaults and view/edit the
   project's `allow` / `deny` lists.
2. **Secret-scan rules** — view built-in rules, enable/disable them, add custom
   `kind + pattern` rules.
3. **Indicator + summary** — a real `secret scanning: on / off` indicator and a
   one-line policy summary (counts of allow / deny / secret rules).

## 2. Constraints (hard requirements)

- **loom-host only.** No new dependency from the host into anything but its own
  code and the existing `@digital-threads/loom-security` package.
- **Additive to shared code.** Any change in `@digital-threads/loom-security`
  must be a *new* export / *optional* parameter — no behavior or signature break.
- **Design system.** `npm run check:ds` must stay green
  (`web/scripts/check-design-system.mjs`): no inline colors/fonts; `fontSize`
  only via `var(--fs-*)`. Layout-only inline styles (margin/gap) stay allowed,
  matching the existing file.
- **UI in English.**
- **No broken tests; `tsc` green for both web and host.**
- **TDD** where testable (the host config module and endpoints).

## 3. Current state (verified)

- `src/core/security/policy.ts` and `secrets.ts` are **re-exports** of
  `@digital-threads/loom-security` (real source in that package's `src/`).
- `policy.ts`: `CommandPolicy { allow?: RegExp[]; deny?: RegExp[] }`,
  `DEFAULT_DENY` (6 patterns), `checkCommand(cmd, policy)`. **`checkCommand` has
  zero usages in the host** — command policy is *not* enforced at runtime yet.
- `secrets.ts`: internal `PATTERNS` (7 kinds, **not exported**), `scanSecrets`,
  `hasSecret`, `redactSecrets`. No on/off switch.
- Secret scanning currently always runs on the normal path:
  `src/web/api.ts:371` calls `scanSecrets(text)` after every turn and audits
  findings. The sandbox path uses `secureExecutor` (`start-run.ts:51`) whose
  `auditSecrets` option defaults to `true`.
- Settings store (`src/core/store/settings.ts`): JSON-encoded per-key values via
  `getSetting` / `setSetting` / `getAllSettings` over a sqlite `settings` table.
- Web↔host: Hono app in `src/web/api.ts`; existing `/api/settings`,
  `/api/timeline`. Web client `web/src/api.ts` exposes `settings()`,
  `saveSetting()`, `timeline()`.

## 4. Design

### 4.1 Where the editable layer lives

The editable policy lives in the **host settings store** (sqlite), not in the
shared package — keeping the package free of Loom knowledge and the change
additive. Keys (all JSON values):

| Key | Type | Meaning | Default |
| --- | --- | --- | --- |
| `security.policy.allow` | `string[]` | allow patterns (regex source strings) | `[]` |
| `security.policy.deny` | `string[]` | project deny patterns (added on top of `DEFAULT_DENY`) | `[]` |
| `security.secrets.enabled` | `boolean` | master on/off for secret scanning | `true` |
| `security.secrets.disabledBuiltins` | `string[]` | built-in rule `kind`s turned off | `[]` |
| `security.secrets.custom` | `{ kind: string; pattern: string }[]` | user-added secret rules | `[]` |

Regex are stored as **source strings** and compiled on read; this is what
survives JSON round-trips and what the UI edits.

### 4.2 New host module (primary TDD target)

`src/core/security/policy-config.ts` — host-only, concentrates all logic so it is
unit-testable without HTTP or React:

- `securityConfigView(db)` → the full real state for the GET endpoint:
  ```ts
  {
    command: {
      defaultDeny: string[];        // DEFAULT_DENY sources (read-only)
      allow: string[];
      deny: string[];               // project deny (editable)
    },
    secrets: {
      enabled: boolean;
      builtins: { kind: string; pattern: string; disabled: boolean }[];
      custom: { kind: string; pattern: string }[];
    },
    summary: { allow: number; deny: number; secretRules: number; scanning: boolean };
  }
  ```
  (`deny` count in summary = `defaultDeny.length + deny.length`; `secretRules` =
  enabled builtins + custom.)
- `setCommandPolicy(db, { allow, deny })` → **validate every pattern** with
  `new RegExp(src)` in a `try`; reject the whole write on the first invalid
  pattern (returns the bad pattern + index). Persist on success.
- `setSecretConfig(db, { enabled?, disabledBuiltins?, custom? })` → validate
  custom patterns the same way; non-empty `kind` required; persist.
- `effectiveCommandPolicy(db): CommandPolicy` → `{ allow, deny }` compiled to
  `RegExp[]`, deny = `DEFAULT_DENY ∪ project deny`. Exposed so a future runtime
  enforcement of `checkCommand` can consume it (enforcement itself is out of
  scope — see §6).
- `secretScanEnabled(db): boolean` → reads `security.secrets.enabled`.

### 4.3 Additive export from the shared package

`@digital-threads/loom-security` `secrets.ts` gains **one read-only export** so
the host can display the real built-in rules:

```ts
export const SECRET_RULES: readonly { kind: string; source: string }[] =
  PATTERNS.map((p) => ({ kind: p.kind, source: p.re.source }));
```

Purely additive (new const, no signature/behavior change). The host re-export
`src/core/security/secrets.ts` already does `export *`, so it propagates.

Custom secret rules and disabled built-ins are **applied host-side** (see §4.5) —
`scanSecrets`' signature is left untouched.

### 4.4 REST endpoints (new, additive)

In `src/web/api.ts`, next to `/api/settings`:

- `GET /api/security/config` → `securityConfigView(db)`.
- `POST /api/security/policy` → body `{ allow: string[]; deny: string[] }`;
  calls `setCommandPolicy`; `400 { error, pattern }` on invalid regex,
  else `{ ok: true }`.
- `POST /api/security/secrets` → body
  `{ enabled?: boolean; disabledBuiltins?: string[]; custom?: {kind,pattern}[] }`;
  calls `setSecretConfig`; `400` on invalid, else `{ ok: true }`.

Web client (`web/src/api.ts`) gains matching methods:
`securityConfig()`, `saveCommandPolicy(allow, deny)`, `saveSecretConfig(patch)`.

### 4.5 Making the on/off indicator real

The `secret scanning: on/off` indicator reflects `security.secrets.enabled` and
**actually gates** the normal scan path:

- `src/web/api.ts:371` — wrap the existing `scanSecrets(text)` audit block in
  `if (secretScanEnabled(db)) { ... }`. When custom rules / disabled built-ins
  are configured, the host filters findings by `disabledBuiltins` and appends
  matches from compiled `custom` patterns (a small host helper
  `hostScanSecrets(db, text)` in `policy-config.ts`, reusing `redact` semantics —
  never echoing full values).
- The sandbox path (`secureExecutor`, `start-run.ts`) is a secondary concern;
  passing the flag there is a follow-up (§6), so this SDD does not claim the
  experimental sandbox path is gated.

### 4.6 UI (`web/src/components/Security.tsx`)

Add three sections below the existing sandbox toggle, using existing DS classes
(`panel`, `kv`, `btn`, `row`, `finding-list`, `muted`, `var(--fs-*)`):

1. **Policy summary + scanning indicator** — a `kv` row: `secret scanning`
   on/off button (mirrors the existing sandbox toggle pattern, optimistic update
   with rollback) and a muted summary line (`N allow · M deny · K secret rules`).
2. **Command policy** — read-only list of `defaultDeny` (labelled "built-in,
   always on"), plus editable `allow` and `deny` lists (add field + remove per
   row). Invalid regex surfaces the server's `400 { pattern }` message inline.
3. **Secret-scan rules** — built-in rules listed with an enable/disable toggle
   each; custom rules with add (`kind`, `pattern`) + remove. Patterns shown as
   source text only; **no secret values are ever displayed**.

State pattern mirrors the current component: `load()` in `useEffect`, `StateView`
for loading/error/empty, optimistic toggles with rollback on failure.

## 5. Testing (TDD)

Host unit tests for `policy-config.ts`:

- `securityConfigView` returns defaults on an empty store; reflects written
  allow/deny/custom/disabled values.
- `setCommandPolicy` rejects an invalid regex (e.g. `"("`) without persisting;
  accepts valid lists.
- `setSecretConfig` rejects invalid custom pattern / empty kind; persists valid.
- `effectiveCommandPolicy` merges `DEFAULT_DENY` with project deny.
- `secretScanEnabled` defaults to `true`, honors a stored `false`.
- `hostScanSecrets` drops findings of disabled built-in kinds, adds custom-rule
  hits, and never returns a full secret value.

Endpoint tests (if the repo has an api test harness): GET shape; POST validation
(`400` on bad regex) and round-trip via GET.

`SECRET_RULES` export covered by a shape assertion in the package's test suite
(kind + source present, count matches `PATTERNS`).

UI: follow existing component-test conventions if present; otherwise the logic is
covered by the host tests and `tsc`/`check:ds` gates.

## 6. Out of scope / follow-ups

- **Runtime enforcement of `checkCommand`** in the executor. Today it is unwired;
  this epic adds view/edit + `effectiveCommandPolicy(db)` so enforcement can be a
  clean, separate change without touching the execution path now.
- **Gating the sandbox `secureExecutor` path** by `security.secrets.enabled`
  (needs the flag threaded into `start-run.ts`). Normal path is gated here.

## 7. Files touched

- **New:** `src/core/security/policy-config.ts` (+ test).
- **Edit (additive):** `@digital-threads/loom-security` `secrets.ts`
  (`SECRET_RULES` export).
- **Edit:** `src/web/api.ts` (3 endpoints; gate at `:371`),
  `web/src/api.ts` (3 client methods),
  `web/src/components/Security.tsx` (3 UI sections).
- Possibly a small CSS addition for new rows — DS-compliant, no inline
  colors/fonts.

## 8. Acceptance criteria

- Security panel shows real `DEFAULT_DENY` and real built-in secret rules.
- User can add/remove allow & deny patterns and custom secret rules, toggle
  built-in rules, and flip scanning on/off; all persist across reload.
- Invalid regex is rejected with a clear inline message; the server never throws.
- Turning scanning off stops new `secret.found` audit events on the normal path;
  turning it on resumes them.
- `npm run check:ds` green; web + host `tsc` green; existing tests pass; new host
  tests pass. UI is English. No full secret value ever rendered or logged.
