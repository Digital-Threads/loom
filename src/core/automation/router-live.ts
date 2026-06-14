// Build the router's candidate pool from live aimux data: one candidate per
// subscription (profile = subscription name), excluding profiles whose health
// report is explicitly failing. Cost/quota are left unknown (eligible) until a
// pricing/quota source feeds them. Inputs injectable for tests.
import { listSubscriptions, listHealth } from "../plugins/aimux/adapter.js";
import type { RouteCandidate } from "./router.js";

type HealthLike = { ok?: boolean; profile?: string; name?: string };

export interface LiveRouteDeps {
  subscriptions?: { name: string }[];
  health?: HealthLike[];
}

export function liveCandidates(deps: LiveRouteDeps = {}): RouteCandidate[] {
  const subs = deps.subscriptions ?? listSubscriptions();
  const health = deps.health ?? (listHealth() as unknown as HealthLike[]);
  const unhealthy = new Set(
    health.filter((h) => h && h.ok === false).map((h) => h.profile ?? h.name).filter(Boolean),
  );
  return subs.filter((s) => !unhealthy.has(s.name)).map((s) => ({ profile: s.name }));
}
