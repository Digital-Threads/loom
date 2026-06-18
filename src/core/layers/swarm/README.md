# @digital-threads/loom-swarm

**When one AI attempt isn't reliable enough, run several in parallel and keep the
best — or the consensus.**

A tiny, dependency-free coordinator that fans out *N* attempts at a task (each
from its own angle), runs them concurrently, and synthesises one result by
majority vote or your own picker. Works **standalone** (library + tests) and
**embedded** in [Loom](https://github.com/Digital-Threads/loom).

## Why you want this

A single LLM attempt is a coin-flip on hard or ambiguous tasks — it can be
confidently wrong. Asking the same model the same thing several times, from
different perspectives, and taking what they agree on (or scoring and picking the
best) is a cheap, well-known way to raise reliability. loom-swarm gives you that
pattern as a clean primitive instead of hand-rolling `Promise.all` + voting every
time.

## How it works

`runSwarmStep(config, attempt)` invokes your `attempt(index, perspective?)`
function `config.attempts` times concurrently, collects the outcomes, and reduces
them. `runConcurrent` / `majorityVote` / `successes` are the underlying primitives
if you want to compose your own strategy.

## Install

```bash
npm install @digital-threads/loom-swarm
```

## Usage

```ts
import { runSwarmStep, majorityVote } from "@digital-threads/loom-swarm";

// Run 3 attempts in parallel, synthesise one result.
const result = await runSwarmStep({ attempts: 3 }, async (i, perspective) => {
  return await solve(task, perspective); // your model call; `perspective` varies per attempt
});

// Or compose the primitives yourself:
const winner = majorityVote(values, (v) => v.id);
```

`SWARM_DEFAULT` is `{ attempts: 3 }`. `successes(outcomes)` filters to the attempts
that didn't throw.

## Part of the Loom ecosystem

Loom is a spec-first AI orchestrator built from independent layers, each with zero
dependency on the host. loom-swarm is the **Swarm** layer — Loom uses it to make
hard pipeline steps more robust; standalone, it's a general-purpose multi-attempt
coordinator.

## Develop

```bash
npm install && npm test && npm run build
```

## License

MIT
