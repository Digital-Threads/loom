# Egress audit — design (loom-xclx, Phase 1)

## Problem

A task's agent runs with full network access (the sandbox uses `--share-net` /
`allow default`). With broad permissions it could, if prompt-injected or buggy,
reach hosts it shouldn't — exfiltrate code/secrets or pull something hostile.
Nothing constrains where it connects today.

The end goal is an **egress allowlist**: the agent reaches only a short set of
hosts (Claude API, package registries, git) and everything else is refused. The
risk in doing that blindly is breaking legitimate access — we don't know the full
set of hosts a real task needs.

## Approach — phased

- **Phase 1 (this spec): observe, don't block.** Route the agent's traffic
  through a local proxy that **logs the host of each connection and forwards it**.
  After real tasks run we have a true list of where the agent goes, which becomes
  the allowlist. Cross-platform (works on Mac/Windows too, via the proxy env).
- **Phase 2 (later): enforce.** The same proxy gains an allowlist and refuses
  anything off it; paired with a network namespace (`unshare-net`) so the agent
  can't bypass the proxy. Linux-only (where the OS sandbox already runs).

The proxy is the durable component — Phase 1 logs, Phase 2 logs + filters.

## Phase 1 components

1. **Egress proxy** (`src/core/layers/security/egress-proxy.ts`)
   - A minimal local forward proxy. For `CONNECT host:port` (HTTPS) it reads the
     **hostname from the CONNECT line — no TLS interception, no certificates** —
     then blind-tunnels the bytes. For plain HTTP it reads the `Host`. Records
     `host:port`, forwards, never blocks.
   - `startEgressProxy({ onHost }) -> { port, close }`. Binds `127.0.0.1:0`
     (random port). `onHost(host, port)` fires once per observed destination.

2. **Session wiring** (`aimux-session-launcher.ts`)
   - When the sandbox/audit is on for a task, start the proxy and pass
     `HTTP_PROXY` / `HTTPS_PROXY = http://127.0.0.1:<port>` plus
     `NO_PROXY=127.0.0.1,localhost` into the agent's env (the launcher already
     forwards env). claude / node / npm / git honour these.

3. **Audit sink**
   - Each first-seen host → `emitAudit` as `audit.egress.observed`, and the task
     accumulates a distinct host set persisted as an `egress-hosts` artifact.

4. **UI** (Security section)
   - "Observed egress" — the distinct hosts the agent has connected to, so the
     operator builds the Phase 2 allowlist from real data.

## Data flow

```
agent ──HTTPS_PROXY──▶ egress-proxy ──(log host)──▶ real host
```

## Error handling

Observation must never break the agent's network. If the proxy fails to start,
skip the proxy env entirely (direct access, as today). Audit writes are
best-effort.

## Testing

- Proxy: `CONNECT` host parsing, plain-HTTP `Host` parsing, byte-forwarding to a
  fake upstream, `onHost` fires once per destination, survives a dropped upstream.
- Wiring: the proxy env is injected only when audit is on; `NO_PROXY` present.
- Audit: `audit.egress.observed` emitted; the host set de-dupes.

## Out of scope (Phase 2)

Blocking, the allowlist, `unshare-net`/netns, refusing off-list hosts. Phase 1
only observes, collects, and shows.
