// L5 — text-stage swarm: run a text-producing stage (e.g. spec) N times under
// different perspectives, then let an LLM judge elect the best candidate. Unlike
// impl-swarm there is no objective build/test gate for prose, and unlike
// runSwarmStep's majority vote two specs are never identical — so selection is a
// judge call. Pure orchestration; the attempt + judge fns are injected, so this
// is testable without agents.

export interface TextSwarmResult {
  /** The elected candidate's text. */
  winner: string;
  /** Its index within `candidates` (0-based). */
  index: number;
  /** All non-empty candidates, in attempt order. */
  candidates: string[];
}

/** Parse a judge's pick into a 0-based index within [0, n). The judge is told to
 *  answer with a 1-based candidate number; we take the first integer it mentions.
 *  Anything unparseable or out of range falls back to 0 (the first candidate), so
 *  a confused judge never loses the work. */
export function pickWinner(judgeText: string, n: number): number {
  const m = judgeText.match(/\d+/);
  if (!m) return 0;
  const idx = Number(m[0]) - 1; // judge answers 1-based
  return idx >= 0 && idx < n ? idx : 0;
}

/** Run a text stage as a swarm: N attempts in parallel (each may use a perspective
 *  lens), then an LLM judge elects the best. Returns null when no attempt yields
 *  usable text — the caller falls back to a single pass. A lone survivor skips the
 *  judge. Never throws: a failed attempt is dropped, and a failed judge defaults to
 *  the first survivor. */
export async function runTextSwarm(
  cfg: { attempts: number; perspectives?: string[] },
  attempt: (index: number, perspective?: string) => Promise<string>,
  judge: (candidates: string[]) => Promise<string>,
): Promise<TextSwarmResult | null> {
  const n = Math.max(1, cfg.attempts);
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      attempt(i, cfg.perspectives?.[i]).then((t) => (t ?? "").trim()).catch(() => "")),
  );
  const candidates = results.filter((t) => t.length > 0);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { winner: candidates[0], index: 0, candidates };
  const verdict = await judge(candidates).catch(() => "");
  const index = pickWinner(verdict, candidates.length);
  return { winner: candidates[index], index, candidates };
}
