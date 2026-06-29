// The implementation stage's drive loop, extracted so its quality gate is unit
// testable (loom-implverify). The agent's "RESULT: DONE" is NOT trusted on its
// own word: when it reports done, Loom independently VERIFIES (runs the repo's
// build + test); a failure is fed back and the agent must fix it. Only a green
// verify counts as done — so unverified/broken code can't leave the impl stage.

export interface ImplLoopDeps {
  /** Send a prompt to the task's impl session; resolves with the agent's reply. */
  send: (prompt: string) => Promise<string>;
  /** Independently verify the work (run build + test). ok=false carries failures. */
  verify: () => Promise<{ ok: boolean; failures: string }>;
  /** Does the reply claim completion (and not still list leftover work)? */
  settled: (text: string) => boolean;
  /** Has the task blown its cost cap? Checked before each extra send. */
  overBudget: () => boolean;
  prompts: {
    first: string;
    cont: string;
    /** Built from the real failure output when verify fails after a "done". */
    fail: (failures: string) => string;
  };
  /** Max extra sends before parking (bounds a looping/huge plan). */
  maxContinues: number;
}

export interface ImplLoopResult {
  /** True only when the agent reported done AND verify passed. */
  verified: boolean;
  /** The last agent reply (for the impl report + completeness note). */
  text: string;
  /** Parked because the cost cap was hit mid-loop. */
  budgetHit: boolean;
}

export async function runImplLoop(d: ImplLoopDeps): Promise<ImplLoopResult> {
  let text = await d.send(d.prompts.first);
  for (let i = 0; i < d.maxContinues; i++) {
    let failures = "";
    if (d.settled(text)) {
      const v = await d.verify();
      if (v.ok) return { verified: true, text, budgetHit: false }; // done AND verified → real DONE
      failures = v.failures; // claimed done, but Loom's build/test failed
    }
    if (d.overBudget()) return { verified: false, text, budgetHit: true };
    text = await d.send(failures ? d.prompts.fail(failures) : d.prompts.cont);
  }
  return { verified: false, text, budgetHit: false };
}
