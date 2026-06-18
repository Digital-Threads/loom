# @digital-threads/loom-knowledge

**Recall the reasoning your AI agents already produced — prior decisions, the
dead-ends they ruled out, and the facts they verified — instead of re-deriving
them every session.**

A small, dependency-light layer that reads an AI coding agent's
[task-journal](https://github.com/Digital-Threads/Task-Journal) memory and turns
it into useful recall: "have we tried X before?", "why did we choose Y?",
semantic search, and a reasoning graph. Works **standalone** (CLI + library) and
**embedded** in [Loom](https://github.com/Digital-Threads/loom).

## Why you want this

LLM agents forget. Every new session re-asks the same questions, re-evaluates the
same options, and sometimes re-walks a path it already proved was a dead-end.
task-journal records the *why* behind work as it happens; **loom-knowledge makes
that history queryable** so an agent (or you) can pull up the relevant prior
decisions and rejections before acting — across your whole history, not just the
current repo.

## How it works

Your agent writes `decision` / `rejection` / `finding` events to task-journal as
it works. loom-knowledge queries that store (via the `task-journal recall` CLI by
default, injectable for tests) and returns ranked hits, partitioned into the
choices that were *made* vs the ones that were *ruled out*. Defensive by design:
any failure returns `[]` — recall is an enhancement, never a blocker.

## Install

```bash
npm install @digital-threads/loom-knowledge
```

## Library

```ts
import { recallPrior, partitionHits } from "@digital-threads/loom-knowledge";

const hits = recallPrior(process.cwd(), "auth token storage", { limit: 5 });
const { decisions, rejections } = partitionHits(hits);

console.log("Already decided:", decisions.map((h) => h.text));
console.log("Already ruled out:", rejections.map((h) => h.text)); // don't repeat these
```

`recallPrior(projectRoot, query, { limit?, run? })` shells out to
`task-journal recall --json` (override `run` to inject). Also exported: a semantic
`ask` search and a reasoning-`graph` builder.

## CLI

```bash
loom-knowledge recall "postgres connector"
```

Prints prior **rejections** and **decisions** for the query in the current project.

## Part of the Loom ecosystem

Loom is a spec-first AI orchestrator built from independent layers, each with zero
dependency on the host. loom-knowledge is the **Knowledge** layer — the orchestrator
surfaces it as the Knowledge section of its UI; on its own, it's just a library +
CLI you can drop into any agent setup.

## Develop

```bash
npm install && npm test && npm run build
```

## License

MIT
