// Session control surface — the contract a live launcher exposes to the pipeline
// BEYOND a one-shot run: cost/denials readout and mid-run lifecycle.
//
// The Claude session protocol itself (the `-p` stream-json multi-turn driver,
// `--session-id`/`--resume`, account relocation) now lives in aimux's
// `openSession`; Loom drives it through `createAimuxLiveLauncher`, which implements
// this interface. Only the TYPE remains here, depended on by the runtime seam and
// the API.

export interface SessionControl {
  /** Cost accumulated for a session (sum of per-turn total_cost_usd). */
  costOf(sessionId: string): number;
  /** Tools the agent tried to use but were denied (await user approval). */
  denialsOf(sessionId: string): string[];
  /** Inject extra guidance into a LIVE session mid-run ("intervene"). No-op if no
   *  live process. */
  interject(sessionId: string, text: string): boolean;
  /** Stop a session's process (e.g. on task done). */
  stop(sessionId: string): void;
  /** Human-readable degradations detected for a session at open time (MCP not
   *  loaded, token-pilot enforcement missing). */
  degradedOf?(sessionId: string): string[];
}
