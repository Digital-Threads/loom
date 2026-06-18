# @digital-threads/loom-quality

**Automated code review and QA for AI-generated changes — so the agent catches
its own bugs before they reach you.**

Configurable Review and QA runners: drive one or several review passes
(self / "ralph" / adversarial), turn raw findings into a pass/hold verdict, and
run QA checks (tests, build, browser). Works **standalone** (library + tests) and
**embedded** in [Loom](https://github.com/Digital-Threads/loom).

## Why you want this

An AI agent that writes code and immediately calls it "done" ships bugs. A
dedicated review step — ideally from more than one adversarial angle — catches
the plausible-but-wrong changes a single pass misses, and a QA step proves the
change actually builds and passes tests. loom-quality packages that as
configurable, reusable runners instead of ad-hoc prompts.

## How it works

- **Review**: `runReviewPasses` runs one or more review passes over a diff;
  `parseFindings` / `dedupeFindings` / `aggregateFindings` normalise the results;
  `reviewHolds` decides whether the findings should *hold* the change (block) or
  pass.
- **Flow config**: `resolveFlow` resolves which review/QA steps are enabled for a
  stage (so the set of checks is configurable, not hard-coded).
- **QA**: the QA runner executes the configured checks (tests / build / browser).

## Install

```bash
npm install @digital-threads/loom-quality
```

## Usage

```ts
import { runReviewPasses, reviewHolds, parseFindings } from "@digital-threads/loom-quality";

const result = await runReviewPasses(diff, { passes: ["self", "adversarial"] });
if (reviewHolds(result, "autopilot")) {
  // findings block the change — send it back for a fix
}
```

Also exported: `resolveFlow` (flow-config) and the QA runner.

## Part of the Loom ecosystem

Loom is a spec-first AI orchestrator built from independent layers, each with zero
dependency on the host. loom-quality is the **Quality** layer — Loom drives its
Review/QA stages with it (and the autopilot uses it to gate its own work);
standalone, it's a set of review/QA runners for any agent pipeline.

## Develop

```bash
npm install && npm test && npm run build
```

## License

MIT
