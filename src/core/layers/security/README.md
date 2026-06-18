# @digital-threads/loom-security

**Let an AI agent edit code without letting it touch your main checkout, run
dangerous commands, or leak secrets.**

The isolation + safety layer: run each agent task in its own throwaway git
**worktree** sandbox, gate the commands it may run with an **allow/deny policy**,
**scan for secrets**, and keep an **audit** trail of what it did. Works
**standalone** (library + tests) and **embedded** in
[Loom](https://github.com/Digital-Threads/loom).

## Why you want this

Giving an autonomous agent a shell in your repo is risky: a bad edit, an `rm`, a
`git push`, or a secret printed into a log can do real damage. loom-security
contains the blast radius — the agent works in an isolated worktree (your branch
stays untouched), only allow-listed commands run, writes are confined, secrets are
scanned, and everything is logged. So you can let the agent work unattended and
still trust your repository.

## How it works

- **Sandbox / worktree**: `ensureWorktree` / `prepareWorktree` create a per-task
  git worktree on its own branch (`worktreeBranch` / `worktreePath`);
  `removeWorktree` reclaims it. The agent's edits live there, never in your main
  working copy, until you choose to merge.
- **Command policy**: `checkCommand` validates a command against the allow/deny
  policy before it runs.
- **Secret scanning**: outputs are scanned so credentials don't leak into logs.
- **Audit**: `audit` / `auditEvent` record a trail of what the agent did.

## Install

```bash
npm install @digital-threads/loom-security
```

## Usage

```ts
import { ensureWorktree, removeWorktree, checkCommand, audit } from "@digital-threads/loom-security";

// Run a task in an isolated sandbox.
const wt = ensureWorktree(repoRoot, taskId);   // own worktree + branch
if (checkCommand("npm test").allowed) {
  // ...run it inside wt.path...
}
audit(/* what happened */);
removeWorktree(repoRoot, taskId);              // reclaim when done
```

## Part of the Loom ecosystem

Loom is a spec-first AI orchestrator built from independent layers, each with zero
dependency on the host. loom-security is the **Security** layer — every Loom task
runs through it, and the orchestrator surfaces its policy / secret-scan / audit
state in the Security section of the UI. Standalone, it's a sandbox + policy +
audit toolkit for any agent that touches a real repository.

## Develop

```bash
npm install && npm test && npm run build
```

## License

MIT
