---
name: pr-description-format
description: Generate a GitHub PR description that reads like a human wrote it — clear, scannable, no fluff. Activates when user asks for "PR description", "PR body", "write the pull request description", or "generate PR text". Uses Conventional Commits in the title and a structure optimized for reviewers who'll skim it. No verification checklist — reviewers run their own checks.
---

# PR Description Format

When the user asks for a PR description, generate it following this template. The reader is a busy reviewer who'll skim — give them what they need fast.

## Core principles

1. **Title says what changed in business terms, not file terms.** "Fix off-by-one in token refresh boundary" — not "Update refresh.rs line 42".

2. **Open with the why.** First sentence after the title is the *reason this PR exists*. Not what files changed — the reviewer can see that.

3. **Reviewer-first ordering.** What changed → why → how → risks → screenshots. The reviewer should be able to stop reading at any point and still know enough to act.

4. **Show, don't decorate.** Skip "🚀 Exciting changes!", skip emoji clusters, skip ASCII art. The PR is a work artifact, not a tweet.

5. **Plain English for non-technical changes.** If the change has user-visible behavior, describe it the way a release note would. Even backend-only PRs benefit from one human-readable sentence.

## Title format

Conventional Commits style:

```
<type>(<scope>): <short description in lowercase, no period>
```

Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`.
Scope is optional — use when the codebase has clear modules.

Examples:
- `fix(auth): refresh token dropped at expiry boundary`
- `feat(billing): add idempotency keys to invoice creation`
- `refactor(payments): extract notification sending to queue worker`
- `perf(search): cache facet aggregations for 60s`

## Body template

Use exactly this structure. Skip a section entirely if it has no content — don't write "N/A".

```markdown
## What

One or two sentences. What this PR does, in human terms.
Not "modifies X, Y, Z" — but "users can now do X" or "stops Y from happening".

## Why

The reason this work was needed. Link to the issue/ticket if there is one.
If the why is non-obvious (this is a bug fix for a subtle issue, or a refactor
prepping for future work), explain it. If it's obvious from the title, one line is fine.

Closes #1284

## How

Bullet list of the substantive changes. Group related changes, don't list every file.
Skip mechanical things (formatting, imports) — git diff shows those.

- Replaced `<` with `<=` in token expiry comparison so the boundary second is treated as still-valid
- Added regression test covering exact boundary timestamp
- Extracted the comparison into `isTokenStillValid()` so future timezone work has one place to update

## Risk

What could go wrong if this is bad. Skip if truly low-risk.

Touches the auth hot path. If the comparison is wrong in the other direction,
expired tokens would be accepted — but the new regression test asserts both
sides of the boundary.

## Screenshots / recordings

Only for UI changes. Drop screenshots inline as Markdown images.
For "before/after" use a two-column table.

| Before | After |
|--------|-------|
| ![before](url) | ![after](url) |

## Notes for reviewer

Anything the diff won't tell them. The non-obvious bits.
The decisions you almost made differently. The thing you tested but cut.

Skip this section if there's nothing surprising.
```

## How sections should feel

**Bad "What" section** (file-level, no meaning):
```
- Updated refresh.rs
- Added test_token_refresh_boundary
- Modified middleware.ts
```

**Good "What" section** (human, business-aware):
```
Tokens that hit their exact expiry second were being rejected as expired,
logging users out one second early. This treats the boundary second as
still-valid and adds a regression test.
```

## Conventions to follow

- **`Closes #123`** in Why — auto-closes the issue on merge
- **`Co-authored-by:`** trailers in the commit body (not PR body) for pairing
- **Draft PR** marker if the work isn't ready — say so at the top: `> Draft: do not merge yet, waiting for upstream X`

## What NOT to include

- Don't paste the full diff or large code blocks — the PR view shows those
- Don't list every commit message — that's the commits tab
- Don't write "I refactored this for readability" without explaining what made it unreadable before
- Don't apologize ("sorry for the big PR") — if it's big, explain why it had to be
- Don't promise future work in the PR body — open a follow-up issue and link it

## Length guidance

- Tiny fix (one-line change): What + Why is enough. 5 lines total.
- Normal PR: half a page to a page
- Large PR: still one page — if you need more, you should split the PR

Hand the description to the user as a single fenced markdown block they can copy directly into the GitHub PR body field.
