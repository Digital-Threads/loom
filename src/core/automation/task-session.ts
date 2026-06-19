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
import { resolveStageModel } from "../pipeline/stage-model.js";

/** One headless turn against a session. resume=false → create with sessionId. */
export interface SessionLauncher {
  run(
    prompt: string,
    opts: { sessionId: string; resume: boolean; model?: string; cwd?: string; env?: Record<string, string>; bypassPermissions?: boolean; allowedTools?: string[]; onChunk?: (chunk: string) => void; profile?: string },
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
  "   ЖУРНАЛ ЗАДАЧИ (task-journal) — это история ЭТОЙ задачи. В начале вызови task_create ОДИН раз",
  "   (он привяжется к текущей задаче), держи возвращённый task_id и пиши ВСЁ в него — не заводи новые.",
  "   Фиксируй В МОМЕНТ, когда происходит, КОРОТКО и по делу (одна-две фразы, file:line/id), НЕ эссе:",
  "   decision (выбранный подход + alternatives — какие варианты взвесил), rejection (что отверг и почему),",
  "   finding (проверенный факт), evidence (что доказал тест). В конце — task_close с итогом.",
  "2. СТРОГО ПО ЗАДАЧЕ (хирургически). Делай РОВНО то, что требует задача — ничего сверх:",
  "   - трогай ТОЛЬКО файлы/код, необходимые для задачи; НЕ «улучшай», не рефактори и не",
  "     переформатируй несвязанный код; не добавляй фич, абстракций, настроек, которых не просили;",
  "   - НИКОГДА не удаляй, не отключай и не ослабляй тест, чтобы он «прошёл». Падающий тест — это",
  "     сигнал починить КОД (или корректно обновить тест, СОХРАНИВ покрытие), а не убрать его;",
  "   - в общем/чужом коде меняй только АДДИТИВНО, не ломая существующее поведение; соблюдай",
  "     существующий стиль соседнего кода;",
  "   - выбирай простейшее решение, минимум кода. Каждая изменённая строка должна напрямую",
  "     следовать из задачи. Если сомневаешься, нужно ли изменение, — не делай его.",
  "3. Только факт. Не выдавай неуверенный или предполагаемый результат. Если есть сомнение или",
  "   результат не финальный — доведи до конца и проверь (чтением кода, тестом, запуском).",
  "   Шаг считается выполненным ТОЛЬКО когда результат проверен и полон.",
  "4. Формат. Отвечай на ЯЗЫКЕ ПОЛЬЗОВАТЕЛЯ (на котором поставлена задача и идёт общение).",
  "   Пиши простым, понятным человеческим языком — без лишнего технического жаргона и машинных",
  "   формулировок. Любой человек должен понять, что сделано и как этим пользоваться.",
  "5. Завершение шага. В конце каждого шага дай краткий понятный итог и ПОСЛЕДНЕЙ строкой укажи",
  "   машиночитаемый статус ровно в таком виде:",
  "     ИТОГ: ГОТОВО            — если шаг полностью выполнен и проверен;",
  "     ИТОГ: НЕ ГОТОВО — <причина> — если остались сомнения/недоделки.",
  "   Пока не ГОТОВО — переход к следующему шагу запрещён.",
  "6. Само-навигация по конвейеру (по необходимости). Если на этом шаге ты понял, что задача реально",
  "   должна быть на ДРУГОЙ стадии — напр. на review нашёл проблему настолько глубокую, что её не",
  "   починить точечно (неверная архитектура/спека → нужен повторный анализ), — НЕ имитируй фикс.",
  "   Отдельной строкой добавь директиву РОВНО так:",
  "     LOOM-RELOCATE: <стадия> | <короткая причина>",
  "   где <стадия> — одна из: analysis, brainstorm, spec, rd, impl, review, qa, pr. Loom вернёт задачу",
  "   туда. Причина ОБЯЗАТЕЛЬНА. Только при реальной необходимости — число переносов ограничено,",
  "   не гоняй задачу по кругу. Не нужен перенос — не добавляй директиву.",
].join("\n");

/** Short mandatory-tools reminder appended to every stage prompt (not just the
 *  first), so token-pilot + task-journal stay non-optional through the session. */
export const TOOLS_ANCHOR =
  "[ОБЯЗАТЕЛЬНО на этом шаге: код читай/ищи ТОЛЬКО через token-pilot " +
  "(smart_read, read_symbol, read_for_edit, find_usages, smart_diff, smart_log, test_summary) — " +
  "НЕ Read/Grep/cat/raw-git. Решения, отклонения и находки фиксируй в task-journal по ходу.]";

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
  /** aimux subscription to run this turn under (else the launcher's default). */
  profile?: string;
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
      const stageModel = !opts.raw && opts.stage ? resolveStageModel(opts.stage) : undefined;
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
      const prompt = resume ? body : `${SESSION_PREAMBLE}\n\n${body}`;
      const res = await deps.launcher.run(prompt, { sessionId, resume, model, cwd: opts.cwd, env: opts.env, bypassPermissions: opts.bypassPermissions, allowedTools: opts.allowedTools, onChunk: opts.onChunk, profile: opts.profile });

      if (!resume && stageModel) setLaneSession(db, taskId, stageModel, sessionId); // new lane → next stage on this model resumes it
      setTaskSession(db, taskId, sessionId); // active lane = the task's current conversation (interject/terminal/relocate target)
      turns += 1;
      return res;
    },
  };
}
