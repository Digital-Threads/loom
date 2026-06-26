// TaskSession — one persistent Claude session per task. Every stage injects its
// instruction into the SAME session (context accumulates), so analysis →
// brainstorm → spec → R&D → impl → review → … keep the thread. The first call
// creates the session (--session-id <uuid>); later calls resume it (--resume).
// The conversation runner is injected (SessionLauncher) so this is testable
// without a real CLI; the real launcher maps to aimux runProfileHeadless with
// the session flags passed through extraArgs (aimux unchanged — additive).

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getTaskSession, setTaskSession, getLaneSession, setLaneSession } from "../store/db.js";
import { getSetting } from "../store/settings.js";
import { resolveStageModel } from "../pipeline/stage-model.js";

/** One headless turn against a session. resume=false → create with sessionId. */
export interface SessionLauncher {
  run(
    prompt: string,
    opts: { sessionId: string; resume: boolean; model?: string; cwd?: string; env?: Record<string, string>; bypassPermissions?: boolean; allowedTools?: string[]; onChunk?: (chunk: string) => void; profile?: string; sandbox?: boolean; effort?: string },
  ): Promise<{ text: string }>;
}

/** Mandatory standing instructions, injected once when the session is created.
 *  These are the user's hard conditions for every task session. */
export const SESSION_PREAMBLE = [
  "You run ONE task in this session from start to finish — context accumulates between steps.",
  "Mandatory rules for the whole session:",
  "",
  "1. Tools (always). To read code use token-pilot (smart_read, read_symbol,",
  "   read_for_edit, find_usages, smart_diff, smart_log, test_summary) — not cat/grep; it saves tokens.",
  "   The TASK JOURNAL (task-journal) is the history of THIS task. At the start call task_create ONCE",
  "   (it binds to the current task), hold the returned task_id and write EVERYTHING to it — don't open new ones.",
  "   Record AT THE MOMENT it happens, SHORT and to the point (one or two sentences, file:line/id), NOT essays:",
  "   decision (the chosen approach + alternatives — which options you weighed), rejection (what you ruled out and why),",
  "   finding (a verified fact), evidence (what a test proved). At the end — task_close with the outcome.",
  "2. Stay on task — surgical. Do exactly what the task needs, and only that:",
  "   - touch only the files the task requires; leave unrelated code, formatting and",
  "     structure exactly as you found it, and build only what's asked — no extra",
  "     features, abstractions or settings;",
  "   - when a test fails, fix the CODE behind it (or correct the test while keeping its",
  "     coverage intact) — never delete, disable or weaken a test just to make it \"pass\";",
  "   - in shared or unfamiliar code, make additive changes that preserve existing",
  "     behavior, and match the surrounding style;",
  "   - choose the simplest solution — the minimum code. Make only changes that trace",
  "     directly to the task; when in doubt, leave it out.",
  "3. Facts only. Don't hand back an uncertain or assumed result. If there's any doubt or the",
  "   result isn't final — finish it and verify (by reading the code, a test, or a run).",
  "   A step counts as done ONLY when the result is verified and complete.",
  "4. Format. Reply in the response language stated in the per-step note (default English) —",
  "   simple, plain human language, no machine jargon; any reader should understand what was",
  "   done and how to use it. These instructions stay in English regardless.",
  "5. Finishing a step. At the end of each step give a short, clear summary and on the LAST line state",
  "   the machine-readable status exactly in this form:",
  "     RESULT: DONE            — if the step is fully done and verified;",
  "     RESULT: NOT DONE — <reason> — if any doubts/loose ends remain.",
  "   Until it's DONE — moving to the next step is forbidden.",
  "6. Self-navigation across the pipeline (when needed). If at this step you realize the task really",
  "   belongs at a DIFFERENT stage — e.g. at review you found a problem so deep it can't be fixed",
  "   surgically (wrong architecture/spec → needs re-analysis) — do NOT fake a fix.",
  "   On a separate line add the directive EXACTLY like this:",
  "     LOOM-RELOCATE: <stage> | <short reason>",
  "   where <stage> is one of: analysis, brainstorm, spec, rd, impl, review, qa, pr. Loom will move the task",
  "   there. The reason is MANDATORY. Only when truly necessary — the number of relocations is limited,",
  "   don't bounce the task in circles. If no relocation is needed — don't add the directive.",
].join("\n");

/** Short mandatory-tools reminder appended to every stage prompt (not just the
 *  first), so token-pilot + task-journal stay non-optional through the session. */
export const TOOLS_ANCHOR =
  "[MANDATORY on this step: read/search code ONLY through token-pilot " +
  "(smart_read, read_symbol, read_for_edit, find_usages, smart_diff, smart_log, test_summary) — " +
  "NOT Read/Grep/cat/raw-git. Record decisions, rejections and findings in task-journal as you go.]";

/** Hard cap on the injected taste-profile, so a bloated "about" can't dominate
 *  the session prompt. Over-budget text is truncated with a marker. */
export const ABOUT_MAX_CHARS = 4000;

/** Build the per-project "about" section injected ONCE at session creation: the
 *  user's standing taste-profile (role, repo conventions, anti-patterns, style),
 *  framed as context to honor alongside the rules above. An empty/blank profile
 *  adds nothing (returns ""); an over-budget one is capped (loom-ioz8). */
export function aboutSection(profile: string): string {
  const text = profile.trim();
  if (!text) return "";
  const capped = text.length > ABOUT_MAX_CHARS ? `${text.slice(0, ABOUT_MAX_CHARS)}\n… (trimmed)` : text;
  return `About this project & how the user likes work done (standing context — honor it like the rules above):\n${capped}`;
}

/** Detect a provider rate-limit / usage-limit message in an agent turn, so the
 *  pipeline can surface WHY a task stopped (limit vs parked vs error) instead of
 *  burying "You've hit your session limit" in the transcript. Returns the reset
 *  hint when the provider includes one. */
export function detectRateLimit(text: string): { hit: boolean; resetsAt?: string } {
  if (!/\b(hit (your|the) (session|usage) limit|rate limit|usage limit reached|too many requests|429)\b/i.test(text)) {
    return { hit: false };
  }
  const reset = text.match(/resets?\s+(?:at\s+)?([0-9][^\n.]{0,40})/i);
  return { hit: true, resetsAt: reset?.[1]?.trim() };
}

/** Parse the mandatory completeness marker the agent appends as the last line.
 *  Conservative: only an explicit "НЕ ГОТОВО" parks the stage; an explicit
 *  "ГОТОВО" or a missing marker is treated as complete (we don't block on a
 *  forgotten marker, only on a declared doubt). */
export function parseCompleteness(text: string): { complete: boolean; note?: string } {
  const m = text.match(/(?:RESULT|ИТОГ):\s*(NOT\s+DONE|НЕ\s+ГОТОВО|DONE|ГОТОВО)(?![\p{L}\p{N}])\s*(?:[—:-]\s*(.*))?/iu);
  if (!m) return { complete: true };
  const complete = !/NOT\s+DONE|НЕ\s+ГОТОВО/iu.test(m[1]);
  return complete ? { complete: true } : { complete: false, note: m[2]?.trim() || "agent reported the step is not complete" };
}

/** Detect when the agent's own text admits the plan isn't finished — it lists
 *  "remaining epics / steps", "осталось реализовать", etc. Multi-step stages
 *  (implementation) sometimes do one chunk and still stamp ГОТОВО; this catches
 *  that contradiction so the stage doesn't advance with work left undone. */
export function declaresRemainingWork(text: string): boolean {
  return /следующи[ехй]\s+(?:эпик|шаг|задач)|оста(?:лось|ётся|лись|ются)\s+(?:реализова|сдела|доде|написа|эпик|задач|шаг|подзадач)|remaining\s+(?:epic|step|task|work|item)|yet\s+to\s+(?:implement|do)|not\s+yet\s+(?:implemented|done)|todo\s*:/iu.test(text);
}

/** Per-stage reinforcement — short reminder of the rules + the step's task. */
export function stageInstruction(stage: string | undefined, instruction: string): string {
  const head = stage ? `Stage: ${stage}.` : "Next step.";
  return [
    `${head} Remember the session rules (token-pilot + task-journal, facts only, plain English without jargon, explicit step completion).`,
    "",
    "Step task:",
    instruction,
  ].join("\n");
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", ru: "Russian" };
/** The per-step response-language note the host appends from the ui.language
 *  setting. The agent's INSTRUCTIONS stay English; this only sets the language of
 *  the agent's reply to the user. Unknown/absent → English. */
export function languageDirective(lang: string | undefined): string {
  const name = LANGUAGE_NAMES[(lang ?? "en").toLowerCase()] ?? "English";
  return `[Response language: reply to the user in ${name}. These instructions remain in English.]`;
}

export interface SendOptions {
  stage?: string;
  /** How many times this task has been relocated back a stage — escalates a
   *  stubborn impl to a stronger model (see resolveStageModel). */
  relocations?: number;
  /** A model the user picked by hand for this stage — wins over the policy. */
  modelOverride?: string;
  /** Send the message verbatim — skip the per-stage instruction wrapper. Used
   *  for free-form chat where the user talks to the agent directly. */
  raw?: boolean;
  cwd?: string;
  env?: Record<string, string>;
  bypassPermissions?: boolean;
  allowedTools?: string[];
  /** Confine the agent's writes to the worktree via the OS sandbox (autopilot
   *  forces this on, regardless of the global Settings toggle). */
  sandbox?: boolean;
  onChunk?: (chunk: string) => void;
  /** aimux subscription to run this turn under (else the launcher's default). */
  profile?: string;
  /** Reasoning effort for this turn (→ claude `--effort`), e.g. "xhigh" for an
   *  ultracode task. Omit → the CLI default. */
  effort?: string;
}

export interface TaskSession {
  readonly taskId: string;
  /** The session uuid once created (empty until the first send). */
  sessionId(): string;
  /** Inject a stage instruction into the task's session. First call creates the
   *  session with the preamble; later calls resume and reinforce. */
  send(instruction: string, opts?: SendOptions): Promise<{ text: string }>;
}

export interface TaskSessionDeps {
  launcher: SessionLauncher;
  /** Generate the session uuid (override for deterministic tests). */
  newId?: () => string;
  /** Compaction: invoked before a send once `turns` reaches the threshold, so a
   *  long session is condensed in place (artifacts stay the durable record). */
  compactEvery?: number;
  compact?: (session: { sessionId: string; cwd?: string }) => Promise<void>;
}

export function createTaskSession(db: Database.Database, taskId: string, deps: TaskSessionDeps): TaskSession {
  const newId = deps.newId ?? randomUUID;
  let turns = 0;
  return {
    taskId,
    sessionId: () => getTaskSession(db, taskId).sessionId ?? "",
    async send(instruction, opts = {}) {
      // A real stage picks a model and runs in that model's lane — its own Claude
      // conversation (same-model stages share one; artifacts carry context across
      // lanes). A raw/verbatim message (the user chatting with the agent) or a
      // stageless send continues the task's ACTIVE conversation instead of forking
      // a new lane. The model is fixed per session, so each model is its own one.
      const stageModel = !opts.raw && opts.stage ? resolveStageModel(opts.stage, { relocations: opts.relocations, override: opts.modelOverride }) : undefined;
      const lane = stageModel ? getLaneSession(db, taskId, stageModel) : getTaskSession(db, taskId);
      const model = stageModel;
      const resume = lane.started;
      const sessionId = lane.sessionId ?? newId();

      if (deps.compact && deps.compactEvery && turns > 0 && turns % deps.compactEvery === 0) {
        await deps.compact({ sessionId, cwd: opts.cwd });
      }

      // Re-inject the mandatory-tools rule on EVERY stage prompt (the full
      // preamble is only sent once at session creation, so on resume it would
      // otherwise decay). Keeps token-pilot + task-journal non-optional.
      const body = opts.raw ? instruction : `${stageInstruction(opts.stage, instruction)}\n\n${TOOLS_ANCHOR}`;
      // On session creation, inject the per-project taste-profile once (after the
      // preamble, before the body) — db is the project's store, so the setting is
      // already per-project. Resume turns skip it, keeping the thread light.
      const about = resume ? "" : aboutSection(getSetting<string>(db, "taste.profile", ""));
      const prompt = resume ? body : [SESSION_PREAMBLE, about, body].filter(Boolean).join("\n\n");
      const res = await deps.launcher.run(prompt, { sessionId, resume, model, cwd: opts.cwd, env: opts.env, bypassPermissions: opts.bypassPermissions, allowedTools: opts.allowedTools, sandbox: opts.sandbox, onChunk: opts.onChunk, profile: opts.profile, effort: opts.effort });

      if (!resume && stageModel) setLaneSession(db, taskId, stageModel, sessionId); // new lane → next stage on this model resumes it
      setTaskSession(db, taskId, sessionId); // active lane = the task's current conversation (interject/terminal/relocate target)
      turns += 1;
      return res;
    },
  };
}
