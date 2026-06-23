# loom-ioz8 — Project taste-profile ("about me") into the session

**Goal:** a stable, compact per-project profile (user role, repo conventions,
anti-patterns, style) is injected into every task session so output matches the
project's taste — editable in the Loom UI.

## Decision (user-chosen)
Profile lives in the **Loom DB as a per-project setting** (`taste.profile`),
edited in the **web UI**. Not in the git repo. Rationale: the Loom store is
already per-project (`~/.loom/state/<projectId>.db`), so a plain setting is
inherently per-project; full Loom control; easy per-project split; no new file
entity in the user's repo.

## Design
1. **Core injection** (`src/core/automation/task-session.ts`):
   - `aboutSection(profile: string): string` — pure, exported. Trims; returns
     `""` when empty; caps to a token budget (`ABOUT_MAX_CHARS = 4000`) with a
     `… (trimmed)` marker; wraps the text in a labeled section that frames it as
     standing user context to honor (peer of the preamble rules).
   - In `send()`, on session **creation only** (`!resume`), read
     `getSetting<string>(db, "taste.profile", "")`, build the section, and
     prepend it after `SESSION_PREAMBLE`:
     `[SESSION_PREAMBLE, about, body].filter(Boolean).join("\n\n")`.
   - Resume turns never re-send it (same as the preamble), keeping context light.

2. **API:** none new — settings are already generic
   (`GET /api/settings`, `client.saveSetting`). `taste.profile` is just a key.

3. **UI** (`web/src/components/Settings.tsx`): a textarea bound to
   `taste.profile` (mirrors the Security allowlist editor), with a char-count /
   budget hint. i18n keys added (English default + ru). DS-compliant: reuse
   existing `inp`/`kv`/`fld-hint` classes, no hardcoded colors/fonts.

4. **Learning synergy (noted, out of scope here):** learning lessons = learned
   tastes; a later step can append confirmed lessons into the same `taste.profile`
   setting. Filed as follow-up, not built now.

## Tests (TDD)
- `aboutSection`: empty → ""; short → labeled section contains the text;
  over-budget → truncated + marker; whitespace-only → "".
- `send()` injection: creation prompt includes the section when the setting is
  set; resume prompt does not; empty setting adds nothing.

## Acceptance
- A non-empty `taste.profile` appears once, on session creation, framed as
  standing context; never on resume; capped to budget.
- Editable + persisted from the Settings page; English UI with ru translation.
- `tsc` clean; unit + component tests green.
