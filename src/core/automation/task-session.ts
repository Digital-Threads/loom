// TaskSession — one persistent Claude session per task. Every stage injects its
// instruction into the SAME session (context accumulates), so analysis →
// brainstorm → spec → R&D → impl → review → … keep the thread. The first call
// creates the session (--session-id <uuid>); later calls resume it (--resume).
// The conversation runner is injected (SessionLauncher) so this is testable
// without a real CLI; the real launcher maps to aimux runProfileHeadless with
// the session flags passed through extraArgs (aimux unchanged — additive).

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getTaskSession, setTaskSession } from "../store/db.js";

/** One headless turn against a session. resume=false → create with sessionId. */
export interface SessionLauncher {
  run(
    prompt: string,
    opts: { sessionId: string; resume: boolean; cwd?: string; env?: Record<string, string>; bypassPermissions?: boolean; allowedTools?: string[]; onChunk?: (chunk: string) => void },
  ): Promise<{ text: string }>;
}

/** Mandatory standing instructions, injected once when the session is created.
 *  These are the user's hard conditions for every task session. */
export const SESSION_PREAMBLE = [
  "Ты ведёшь ОДНУ задачу в этой сессии от начала до конца — контекст копится между шагами.",
  "Обязательные правила на всю сессию:",
  "",
  "1. Инструменты (всегда). Для чтения кода используй token-pilot (smart_read, read_symbol,",
  "   read_for_edit, find_usages, smart_diff, smart_log, test_summary) — не cat/grep, это экономит токены.",
  "   Решения, находки и причины фиксируй через task-journal. Применяй наши модули, держи их в уме.",
  "2. Только факт. Не выдавай неуверенный или предполагаемый результат. Если есть сомнение или",
  "   результат не финальный — доведи до конца и проверь (чтением кода, тестом, запуском).",
  "   Шаг считается выполненным ТОЛЬКО когда результат проверен и полон.",
  "3. Формат. Отвечай на ЯЗЫКЕ ПОЛЬЗОВАТЕЛЯ (на котором поставлена задача и идёт общение).",
  "   Пиши простым, понятным человеческим языком — без лишнего технического жаргона и машинных",
  "   формулировок. Любой человек должен понять, что сделано и как этим пользоваться.",
  "4. Завершение шага. В конце каждого шага дай краткий понятный итог и ПОСЛЕДНЕЙ строкой укажи",
  "   машиночитаемый статус ровно в таком виде:",
  "     ИТОГ: ГОТОВО            — если шаг полностью выполнен и проверен;",
  "     ИТОГ: НЕ ГОТОВО — <причина> — если остались сомнения/недоделки.",
  "   Пока не ГОТОВО — переход к следующему шагу запрещён.",
].join("\n");

/** Parse the mandatory completeness marker the agent appends as the last line.
 *  Conservative: only an explicit "НЕ ГОТОВО" parks the stage; an explicit
 *  "ГОТОВО" or a missing marker is treated as complete (we don't block on a
 *  forgotten marker, only on a declared doubt). */
export function parseCompleteness(text: string): { complete: boolean; note?: string } {
  const m = text.match(/ИТОГ:\s*(НЕ\s+ГОТОВО|ГОТОВО)\s*(?:[—:-]\s*(.*))?/iu);
  if (!m) return { complete: true };
  const complete = !/НЕ\s+ГОТОВО/iu.test(m[1]);
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
  const head = stage ? `Стадия: ${stage}.` : "Следующий шаг.";
  return [
    `${head} Помни правила сессии (token-pilot + task-journal, только факт, язык пользователя без жаргона, явное завершение шага).`,
    "",
    "Задача шага:",
    instruction,
  ].join("\n");
}

export interface SendOptions {
  stage?: string;
  /** Send the message verbatim — skip the per-stage instruction wrapper. Used
   *  for free-form chat where the user talks to the agent directly. */
  raw?: boolean;
  cwd?: string;
  env?: Record<string, string>;
  bypassPermissions?: boolean;
  allowedTools?: string[];
  onChunk?: (chunk: string) => void;
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
      const sess = getTaskSession(db, taskId);
      const resume = sess.started;
      const sessionId = sess.sessionId ?? newId();

      if (deps.compact && deps.compactEvery && turns > 0 && turns % deps.compactEvery === 0) {
        await deps.compact({ sessionId, cwd: opts.cwd });
      }

      const body = opts.raw ? instruction : stageInstruction(opts.stage, instruction);
      const prompt = resume ? body : `${SESSION_PREAMBLE}\n\n${body}`;
      const res = await deps.launcher.run(prompt, { sessionId, resume, cwd: opts.cwd, env: opts.env, bypassPermissions: opts.bypassPermissions, allowedTools: opts.allowedTools, onChunk: opts.onChunk });

      if (!resume) setTaskSession(db, taskId, sessionId); // created → next send resumes
      turns += 1;
      return res;
    },
  };
}
