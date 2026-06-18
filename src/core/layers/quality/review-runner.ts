// L6.2/6.3 — run the resolved review passes and decide the triage action. Each
// pass is built by an injected factory (a pass = an aimux agent running a skill
// via the executor+sandbox); aggregation/verdict come from runReviewPasses.
import { runReviewPasses, type ReviewPass, type ReviewResult } from "./review.js";

export type PassFactory = (key: string) => ReviewPass;

/** Build passes from the resolved keys (L6.1) and run them. */
export function runReview(passKeys: string[], makePass: PassFactory): Promise<ReviewResult> {
  return runReviewPasses(passKeys.map(makePass));
}

export type ReviewMode = "autofix" | "triage";
export type ReviewAction = "accept" | "autofix" | "return";

/**
 * Decide what happens after review (L6.3): clean → accept; otherwise either
 * auto-fix (agent fixes in sandbox, gate before accept) or return the task to
 * in-progress for the human/AI to triage the findings.
 */
export function reviewAction(result: ReviewResult, mode: ReviewMode): ReviewAction {
  if (result.passed) return "accept";
  return mode === "autofix" ? "autofix" : "return";
}

/**
 * Should the review stage hold for the user instead of auto-advancing? Blockers
 * (bugs → !passed) always hold. Non-blocking findings (warn/info) also hold so
 * the user can choose to fix them — except in autopilot, which runs hands-off
 * through anything short of a blocker.
 */
export function reviewHolds(result: ReviewResult, runMode?: string): boolean {
  if (!result.passed) return true;
  return result.findings.length > 0 && runMode !== "autopilot";
}
