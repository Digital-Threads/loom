# SDD — Add root CHANGELOG.md (Unreleased)

Date: 2026-06-18
Task: tj-k54r8qbt6b
Class: chore (docs-only)

## 1. Goal

Add a `CHANGELOG.md` at the repository root with a single `Unreleased`
section listing 4–6 short, factual entries for the recent fixes. The change
doubles as a live check that the task-journal infrastructure records events.
No code, no new features.

## 2. Background / why

There is no changelog today (`ls` of the repo root confirms it). Several
user-facing fixes have landed recently and are worth surfacing in one place.
The wording for two of them already exists in `README.md` (Reliability
section, lines 88–91) and should be reused so the entries stay truthful.

## 3. Scope

In scope:
- Create `/CHANGELOG.md` with a `## [Unreleased]` section and a bulleted list.

Out of scope:
- Versioned release sections / release dates.
- Touching `package.json` `files` (CHANGELOG is not shipped in the package —
  noted as an observation only, not part of this task).
- Any source or build code changes.

## 4. Content — the entries

Format: "Keep a Changelog"-style, English, concise. Each bullet states what
changed from the user's point of view. Source of truth for the first two is
README:90–91 and commit `952d324`; the rest come from earlier fixes.

1. **Rate-limit recovery + auto-fallback** — when an account hits its usage
   limit, the task continues the same session on another account with
   headroom; if the user doesn't pick one, an auto-fallback does after a short
   grace window, and the task is parked honestly when no account is free.
2. **Reliable Stop** — stopping an agent is final; it never auto-resumes,
   restarting is always explicit.
3. **File viewer returns 404 instead of 403** — requesting a missing file in
   the viewer now responds with "not found" rather than "forbidden".
4. **Host-agnostic PR link** — the pull-request link is built without
   assuming a specific host.
5. **Task-journal availability** — task-journal is reachable for sessions so
   reasoning-chain events get recorded.

(4–6 bullets satisfied: 5 entries.)

## 5. File layout

```
CHANGELOG.md            # new, repo root
## [Unreleased]
### Fixed
- <bullets above>
```

Use a `### Fixed` subsection since all entries are fixes; this matches the
Keep a Changelog convention and keeps room for `Added`/`Changed` later.

## 6. Verification

- Run `bun run check:ds` (design-system check) — must pass.
- Optionally run the full `bun run build` (it starts with `check:ds`, then
  `tsc`, `vite build web`, `copy:manifests`) to confirm nothing regressed.
- Adding a markdown file must not affect TS compilation or the design-system
  check; a clean pass is the acceptance signal.

## 7. Acceptance criteria

- `CHANGELOG.md` exists at the repo root with an `Unreleased` section and
  4–6 bullets covering: rate-limit recovery + auto-fallback, reliable Stop,
  file-viewer 404-not-403, host-agnostic PR link, task-journal availability.
- Entries are factual (consistent with README and commit history).
- `check:ds` (and/or `build`) passes.

## 8. Risks

- Low. Docs-only; no impact on build or runtime. Only risk is inaccurate
  wording — mitigated by sourcing entries from README and git history.
