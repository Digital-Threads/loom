---
name: code-review-format
description: Format code review output as a senior engineer would write it — readable, human, business-aware. Activates when user asks for code review, PR review, diff review, or "review this code/branch". Combines technical depth with business logic awareness (Semantic Review). Output is plain prose review, not a linter report.
---

# Code Review Format

When the user asks for a code review, format the output following this guide. The goal is a review that reads like a thoughtful senior engineer wrote it — not a checklist, not a linter dump.

## Core principles

1. **Talk to a human, not a compiler.** Write the way you'd explain something to a teammate over coffee. "This will break when the user has no email" — not "Violates null-safety contract".

2. **Business logic comes first.** Before any technical critique, check: does this code do the right thing for the user/domain? A perfectly clean function that solves the wrong problem is worse than a messy one that solves the right problem.

3. **Show severity through ordering, not labels.** Don't slap [CRITICAL] / [MAJOR] / [MINOR] on everything. Put the important things first. Smaller observations come later or in a "Nits" section.

4. **One observation = one paragraph.** Title (short, what's wrong), explanation (why it matters in human terms), evidence (file:line or quoted snippet), suggestion (concrete fix if obvious, otherwise a question).

5. **Don't moralize.** No "you should always", "this violates", "this is bad practice". State the problem and the consequence. The reader will draw the conclusion.

6. **Skip empty praise.** Don't open with "Overall the code looks great!" if you're about to find issues. If everything actually is fine, say it once at the end.

## Required structure

Use exactly these sections, in this order. Omit a section if it has no content (don't write "None" — just skip it).

```
## TL;DR
One paragraph (2-4 sentences). What was reviewed, what's the headline finding,
should this ship as-is or not.

## Business logic
Does the code do the right thing for the domain? Edge cases the author may
have missed. Wrong assumptions about user/data/flow. This section comes first
because it matters most — code that's clean but solves the wrong problem
is worse than code that's messy but correct.

## Correctness
Bugs, race conditions, error handling, null/undefined paths, off-by-one,
incorrect state transitions. Anything that produces a wrong result or crash.

## Security & data
Auth checks, input validation, secrets, SQL injection, XSS, IDOR, leaked PII.
Skip if there's nothing here — don't write "no security issues found".

## Design & maintainability
Coupling, boundaries, naming that misleads, abstractions that hide too much
or too little. Only if it actually matters — not every "could be cleaner"
deserves a paragraph.

## Tests
What's covered, what's not, what tests would have caught the bugs above.
Be specific: "test_user_login_success exists but test_user_login_with_locked_account
doesn't, and that's the code path most likely to break."

## Nits
Small stuff: naming, formatting, dead code, minor duplication. Group them
into a bullet list so they don't drown the important findings.

## Verdict
One line. Choose one:
- "Ship it" — minor or no issues
- "Ship after addressing X" — clear path forward
- "Needs another round" — substantive issues
- "Don't ship" — fundamental problems
```

## How each finding should read

**Bad** (terminology-dump, no human meaning):
> The `processPayment` function violates SRP by mixing validation, persistence, and notification logic. This creates tight coupling and reduces testability.

**Good** (human, specific, actionable):
> ### `processPayment` is doing three jobs
>
> It validates input, writes to the DB, *and* sends the confirmation email — all
> inside one function. The practical problem: when the SMTP server is down, the
> payment fails even though it was already recorded. The email send should happen
> after commit, ideally on a queue.
>
> `src/payments/service.ts:84-127`

**Bad** (vague):
> Error handling could be improved.

**Good** (concrete):
> ### Errors from `fetchUser` get swallowed
>
> Line 42 wraps the call in `try/catch` and returns `null` on any failure. That
> means a database timeout looks identical to "user doesn't exist" to the caller,
> and the caller responds with 404 either way. The user sees "not found" when
> actually the DB is on fire.
>
> `src/auth/middleware.ts:42`

## What NOT to do

- Don't number issues globally ("Issue #1", "Issue #2") — use H3 headings with names
- Don't use [CRITICAL]/[MAJOR]/[MINOR] tags — order them by importance instead
- Don't quote design principle names ("SOLID", "DRY", "YAGNI") — explain the actual problem
- Don't review the diff if you can also see the surrounding code — context matters
- Don't suggest rewrites of working code unless they fix a stated problem
- Don't be polite-padding ("just a small thought", "feel free to ignore") — say what you mean

## Length guidance

- Tiny PR (1-2 files, <50 LOC): 5-10 sentences total is fine
- Normal PR (5-10 files): one page of markdown
- Big PR: stop and ask the author to split it before reviewing in detail

Always end with the Verdict line — the reader needs to know the bottom line in one glance.
