import type { WorkspaceData } from "../data/loader.js";
import { taskDetailFromEvents, tokenMetricsFromEvents } from "../plugins/task-journal/adapter.js";
import { tokensForTask, tokensBySessionForTask } from "../metrics/tokens-per-task.js";
import { relatedSessions } from "../metrics/related-sessions.js";

// Реестр дериваций v1 — чистые функции над WorkspaceData. Кросс-плагинные склейки
// (join sessions+tokens, корреляция токенов задачи и т.п.) принадлежат хосту, не плагину:
// после Phase 9 плагины — отдельные пакеты и видят только свои load()-данные.
// Каждая деривация ОБОРАЧИВАЕТ существующую функцию метрик/адаптера — логику не дублируем.

export interface SessionWithTokens {
  sessionId: string;
  profile: string;
  used: number;
  saved: number;
}

// Join data.sessions + data.tokens по sessionId. Перенос inline-логики из SessionsPanel.
export function sessionsWithTokens(data: WorkspaceData): SessionWithTokens[] {
  return data.sessions.map((s) => {
    const t = data.tokens.find((x) => x.sessionId === s.sessionId);
    return {
      sessionId: s.sessionId,
      profile: s.profile,
      used: t?.used ?? 0,
      saved: t?.saved ?? 0,
    };
  });
}

// Итоги по всем токен-строкам. Перенос inline reduce из TokensPanel.
export function tokenTotals(data: WorkspaceData): { used: number; saved: number } {
  return data.tokens.reduce(
    (acc, t) => ({ used: acc.used + t.used, saved: acc.saved + t.saved }),
    { used: 0, saved: 0 },
  );
}

export function taskTitle(data: WorkspaceData, taskId: string): string {
  return data.tasks.find((t) => t.id === taskId)?.title ?? "";
}

export function taskDetail(data: WorkspaceData, taskId: string) {
  return taskDetailFromEvents(data.taskEvents, taskId);
}

export function tokensForTaskD(data: WorkspaceData, taskId: string) {
  return tokensForTask(data.taskEvents, taskId, data.tokenEvents);
}

export function tokensBySessionForTaskD(data: WorkspaceData, taskId: string) {
  return tokensBySessionForTask(data.taskEvents, taskId, data.tokenEvents, data.sessions);
}

export function relatedSessionsD(data: WorkspaceData, taskId: string) {
  return relatedSessions(data.taskEvents, taskId, data.sessions, data.tokens);
}

export function tokenMetrics(data: WorkspaceData, taskId: string) {
  return tokenMetricsFromEvents(data.taskEvents, taskId);
}

// Ключи реестра — имена, на которые ViewSpec ссылается через {fn,args}.
// Имена соответствуют спеке view-schema.md (раздел «Реестр деривлаций v1»).
export const derivations: Record<string, (data: WorkspaceData, ...args: any[]) => unknown> = {
  sessionsWithTokens,
  tokenTotals,
  taskTitle,
  taskDetail,
  taskDetailFromEvents: taskDetail,
  tokensForTask: tokensForTaskD,
  tokensBySessionForTask: tokensBySessionForTaskD,
  relatedSessions: relatedSessionsD,
  tokenMetrics,
  tokenMetricsFromEvents: tokenMetrics,
};
