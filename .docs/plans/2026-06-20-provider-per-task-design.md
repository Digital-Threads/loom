# Provider choice per task — design (loom-mx5p MVP, G2)

## Context

aimux is already multi-provider: a profile carries a `cli` (claude / codex / …),
there's a `CliAdapter` per cli (model args, resume, auth, headless, sharing), an
`adapterFor(cli)` registry, plus Codex scanners, an API-profile path, a cross-CLI
`handoff`, and GLM pricing. Loom doesn't surface any of it — a task runs on one
implicit profile.

This MVP lets the operator **pick the provider (profile) for a task**. It mirrors
the existing per-stage model lanes: a different provider is a different session,
and context crosses between them through artifacts, exactly as it does between
model tiers today. No in-session handoff (that's a later phase).

## What changes (all in loom-host; aimux untouched for claude/codex)

1. **Provider × model resolution.** `STAGE_MODEL` hands out opus/sonnet/haiku —
   Claude tiers, meaningless for a non-Claude profile. `resolveStageModel` gains a
   `profileModel?` input: when the active profile pins a model (non-Claude
   profiles do), it wins over the tier policy. Priority: explicit override >
   profileModel > impl escalation > Claude tier map. So a Codex/GLM stage runs the
   profile's model, never "opus".

2. **Lane key includes the provider.** Two stages share a session only if they
   resolve to the same model AND the same profile/cli — a different provider can't
   physically share a session. Context still crosses lanes via artifacts.

3. **UI.** A provider/profile picker in the task view, beside the model picker,
   setting `task.profile`. Works immediately with configured claude/codex profiles.

## Out of scope (next steps)

- Per-stage providers (analysis=Claude, impl=GLM) — the natural extension once
  per-task lands, mirroring the per-stage model picker.
- New providers (DeepSeek/GLM) as profiles — a separate aimux change (G1,
  loom-f3m4): a new `CliAdapter` if they ship a CLI, or via `apiProfile`.
- In-session switch on rate-limit (handoff + capability-degrade) — a later phase
  (loom-yzmk), using aimux's existing `handoff`.

## Testing

- `resolveStageModel`: a pinned `profileModel` wins over the tier; an explicit
  override still wins over the profileModel; claude profiles keep the tier policy.
- Lane key: same model + different profile → different lanes.
- Picker: selecting a profile persists `task.profile`.
