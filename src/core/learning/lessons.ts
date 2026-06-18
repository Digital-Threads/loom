// Learning (L8) — lessons: a derived, READ-ONLY view over what keeps going wrong,
// so the next run can avoid it. No new store — computed on read from data that
// already exists (review findings + user corrections). Two signal sources:
//
//  1. Recurring review/QA findings. Signature = the reliable axes (severity +
//     file), NOT prose. A finding is a lesson only once it recurs across ≥ minRuns
//     DISTINCT tasks — one-off noise stays out.
//  2. Explicit user corrections ("that's wrong, do it this way"). Deliberate, so a
//     SINGLE correction is already a lesson (no recurrence threshold), and it ranks
//     above inferred finding-lessons.
//
// Pure + injectable: the caller loads the raw data and passes it in (same pattern
// as priors.ts), so this is testable without a store.

export interface LessonFinding {
  taskId: string;
  severity: string;
  message: string;
  file?: string;
  ts?: number;
}

export interface LessonCorrection {
  taskId: string;
  message: string;
  file?: string;
  ts?: number;
}

export type LessonKind = "finding" | "correction";

export interface Lesson {
  signature: string;
  kind: LessonKind;
  severity?: string;
  file?: string;
  /** Distinct tasks for a finding; correction count for a correction. */
  occurrences: number;
  taskIds: string[];
  sampleMessages: string[];
  firstSeen?: number;
  lastSeen?: number;
}

export interface ComputeLessonsOptions {
  /** Min distinct tasks a finding signature must recur across to count as a lesson
   *  (avoids over-reacting to one-offs). Default 2. Corrections ignore this. */
  minRuns?: number;
  /** Max sample messages kept per lesson. Default 3. */
  maxSamples?: number;
}

/** Stable signature for a finding: the reliable axes only (severity + file). */
export function lessonSignature(f: { severity?: string; file?: string }): string {
  return `${(f.severity ?? "?").toLowerCase()}::${f.file ?? "*"}`;
}

/** Signature for a correction: the file it's about, else a coarse message bucket
 *  (first few normalized tokens) so near-identical corrections merge. */
export function correctionSignature(c: { file?: string; message?: string }): string {
  if (c.file) return `correction::${c.file}`;
  const bucket = (c.message ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return `correction::${bucket || "*"}`;
}

interface Acc {
  signature: string;
  kind: LessonKind;
  severity?: string;
  file?: string;
  taskIds: Set<string>;
  messages: string[];
  count: number;
  firstSeen?: number;
  lastSeen?: number;
}

/**
 * Fold review findings + user corrections into ranked lessons. Findings need to
 * recur across ≥ minRuns distinct tasks; corrections are kept unconditionally and
 * ranked first. Stateless: same input → same output.
 */
export function computeLessons(
  findings: LessonFinding[],
  corrections: LessonCorrection[] = [],
  opts: ComputeLessonsOptions = {},
): Lesson[] {
  const minRuns = opts.minRuns ?? 2;
  const maxSamples = opts.maxSamples ?? 3;
  const acc = new Map<string, Acc>();

  const bump = (
    signature: string,
    kind: LessonKind,
    fields: { severity?: string; file?: string },
    taskId: string,
    message: string | undefined,
    ts: number | undefined,
  ): void => {
    let a = acc.get(signature);
    if (!a) {
      a = { signature, kind, severity: fields.severity, file: fields.file, taskIds: new Set(), messages: [], count: 0 };
      acc.set(signature, a);
    }
    a.taskIds.add(taskId);
    a.count += 1;
    const msg = message?.trim();
    if (msg && !a.messages.includes(msg) && a.messages.length < maxSamples) a.messages.push(msg);
    if (ts != null) {
      a.firstSeen = a.firstSeen == null ? ts : Math.min(a.firstSeen, ts);
      a.lastSeen = a.lastSeen == null ? ts : Math.max(a.lastSeen, ts);
    }
  };

  for (const f of findings) bump(lessonSignature(f), "finding", { severity: f.severity, file: f.file }, f.taskId, f.message, f.ts);
  for (const c of corrections) bump(correctionSignature(c), "correction", { file: c.file }, c.taskId, c.message, c.ts);

  const lessons: Lesson[] = [];
  for (const a of acc.values()) {
    // Findings need cross-task recurrence; a single user correction is already a lesson.
    if (a.kind === "finding" && a.taskIds.size < minRuns) continue;
    lessons.push({
      signature: a.signature,
      kind: a.kind,
      severity: a.severity,
      file: a.file,
      occurrences: a.kind === "finding" ? a.taskIds.size : a.count,
      taskIds: [...a.taskIds],
      sampleMessages: a.messages,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
    });
  }

  // Rank: corrections first (deliberate > inferred), then by occurrences, then recency.
  lessons.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === "correction" ? -1 : 1;
    if (y.occurrences !== x.occurrences) return y.occurrences - x.occurrences;
    return (y.lastSeen ?? 0) - (x.lastSeen ?? 0);
  });
  return lessons;
}

/**
 * A compact "recurring issues to avoid" block for injecting the top-K lessons
 * (already ranked, corrections first) into an impl/review stage prompt. Returns
 * "" when there is nothing to inject, so the caller can append unconditionally.
 */
export function lessonsPromptBlock(lessons: Lesson[], maxK = 5): string {
  const top = lessons.slice(0, Math.max(0, maxK));
  if (!top.length) return "";
  const line = (l: Lesson): string => {
    const where = l.file ? ` (${l.file})` : "";
    const msg = l.sampleMessages[0] ?? l.signature;
    const tag = l.kind === "correction" ? "your correction" : `${l.severity ?? "issue"}, recurred ×${l.occurrences}`;
    return `- [${tag}]${where} ${msg}`;
  };
  return [
    "",
    "Recurring issues to AVOID in this project (learned from past runs and your corrections):",
    ...top.map(line),
  ].join("\n");
}
