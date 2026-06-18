// Auto-fallback: when a task's subscription hits its rate limit and the user
// doesn't pick a replacement within a grace window, Loom switches to the next
// subscription that still has headroom and continues the SAME session there.
// This module holds the pure decision (which profile to fall back to); the
// server runs it on a timer and performs the switch.

export interface ProfileLimit {
  profile: string;
  status?: string; // "allowed" | "rejected" | …
  fiveHourPct?: number;
}

/** Pick the subscription to fall back to when `current` is rate-limited: the
 *  first OTHER profile that's allowed (has headroom). Returns null when there's
 *  none — a single subscription, or all are exhausted — so the caller keeps the
 *  task parked and honest instead of pretending to switch. Profiles are taken
 *  as given (from the live limits probe); names are never hardcoded. */
export function pickFallbackProfile(limits: ProfileLimit[], current: string): string | null {
  for (const l of limits) {
    if (l.profile === current) continue;
    const hasHeadroom = l.status === "allowed" && (l.fiveHourPct == null || l.fiveHourPct < 95);
    if (hasHeadroom) return l.profile;
  }
  return null;
}

/** Should a parked rate-limited task auto-fall-back yet? True once it has been
 *  parked at least `graceMs` (default 60s) — long enough for the user to choose
 *  in the modal first. */
export function shouldAutoFallback(parkedAtMs: number, nowMs: number, graceMs = 60_000): boolean {
  return nowMs - parkedAtMs >= graceMs;
}
