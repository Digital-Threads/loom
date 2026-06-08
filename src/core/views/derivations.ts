import type { WorkspaceData } from "../data/loader.js";
import { tokenMetricsFromEvents } from "../plugins/task-journal/adapter.js";
import { tokensForTask, tokensBySessionForTask, tasksWithTokens } from "../metrics/tokens-per-task.js";
import { relatedSessions } from "../metrics/related-sessions.js";
import { layerSummary } from "../dashboard/layers.js";
import { buildTimeline } from "../timeline/timeline.js";

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

export function tokensForTaskD(data: WorkspaceData, taskId: string) {
  return tokensForTask(data.taskEvents, taskId, data.tokenEvents);
}

export function tokensBySessionForTaskD(data: WorkspaceData, taskId: string) {
  return tokensBySessionForTask(data.taskEvents, taskId, data.tokenEvents, data.sessions);
}

export function relatedSessionsD(data: WorkspaceData, taskId: string) {
  return relatedSessions(data.taskEvents, taskId, data.sessions, data.tokens);
}

// ── Display-деривации для декларативных видов (Task 7.4) ──────────────────────
// Возвращают строки с уже-сформатированными полями под колонки/секции рендереров.
// Пинненные деривации выше (sessionsWithTokens/tokenTotals/taskDetail*) НЕ трогаем —
// их форма зафиксирована toEqual-тестами. Эти display-деривации — отдельные.

// Итоговая строка токенов одной summary-строкой "потрачено X · сэкономлено Y"
// (Bind не вытаскивает под-поле из {used,saved}; SummaryView вставляет "label: value",
// поэтому итог = одна строка-значение под лейблом "Всего" → "Всего: потрачено X · …").
export function tokenTotalsLine(data: WorkspaceData): string {
  const t = tokenTotals(data);
  return `потрачено ${t.used} · сэкономлено ${t.saved}`;
}

// Строки таблицы Сессий: idShort = slice(0,8), tokens = "used/saved", profileTokens =
// profile.padEnd(12)+" "+tokens — точное воспроизведение строки SessionsPanel при gap=2.
export function sessionRows(data: WorkspaceData): Array<{ sessionId: string; idShort: string; profile: string; tokens: string; profileTokens: string }> {
  return sessionsWithTokens(data).map((s) => {
    const tokens = `${s.used}/${s.saved}`;
    return {
      sessionId: s.sessionId,
      idShort: s.sessionId.slice(0, 8),
      profile: s.profile,
      tokens,
      profileTokens: `${s.profile.padEnd(12)} ${tokens}`,
    };
  });
}

// Строки таблицы Токенов: idShort = slice(0,8); used/saved — числа (padStart в колонках).
export function tokenRows(data: WorkspaceData): Array<{ sessionId: string; idShort: string; used: number; saved: number }> {
  return data.tokens.map((t) => ({
    sessionId: t.sessionId,
    idShort: t.sessionId.slice(0, 8),
    used: t.used,
    saved: t.saved,
  }));
}

// Строки таблицы Задач: title усечён до 60 (как в TasksPanel), status для маркера ✓/○.
export function taskRows(data: WorkspaceData): Array<{ id: string; title: string; status: string }> {
  return data.tasks.map((t) => ({ id: t.id, title: t.title.slice(0, 60), status: t.status }));
}

// «Вероятно связанные сессии» — {text:"id8 · profile||— · used/saved"} (как в TaskDetail).
export function relatedSessionLines(data: WorkspaceData, taskId: string): Array<{ sessionId: string; text: string }> {
  return relatedSessions(data.taskEvents, taskId, data.sessions, data.tokens).map((r) => ({
    sessionId: r.sessionId,
    text: `${r.sessionId.slice(0, 8)} · ${r.profile || "—"} · ${r.used}/${r.saved}`,
  }));
}

// Итоговая строка токенов задачи: "потрачено X · сэкономлено Y" (как в TaskDetail).
export function taskTokensSummary(data: WorkspaceData, taskId: string): string {
  const t = tokensForTask(data.taskEvents, taskId, data.tokenEvents);
  return `потрачено ${t.used} · сэкономлено ${t.saved}`;
}

// Разбивка токенов по сессиям: {text:"profile · id8 — used/saved"} (как в TaskDetail).
export function taskTokenBreakdownLines(data: WorkspaceData, taskId: string): Array<{ sessionId: string; text: string }> {
  return tokensBySessionForTask(data.taskEvents, taskId, data.tokenEvents, data.sessions).map((r) => ({
    sessionId: r.sessionId,
    text: `${r.profile} · ${r.sessionId.slice(0, 8)} — ${r.used}/${r.saved}`,
  }));
}

// Последняя записанная метрика: "в журнале записано: потрачено X · сэкономлено Y" или "".
export function taskRecordedMetricLine(data: WorkspaceData, taskId: string): string {
  const recorded = tokenMetricsFromEvents(data.taskEvents, taskId);
  const last = recorded.length ? recorded[recorded.length - 1] : null;
  return last ? `в журнале записано: потрачено ${last.used} · сэкономлено ${last.saved}` : "";
}

// Строки таблицы Задач с токенами: оборачивает tasksWithTokens. ЧЕСТНОСТЬ overlap →
// число завышено (double-count) → не выдаём за факт, помечаем "≈ … (перекрытие)".
export function tasksWithTokensRows(data: WorkspaceData) {
  return tasksWithTokens(data.taskEvents, data.tasks, data.tokenEvents).map((r) => ({
    id: r.id,
    title: r.title.slice(0, 50),
    status: r.status,
    used: r.used,
    saved: r.saved,
    overlap: r.overlap,
    mode: r.mode,
    badge: r.mode === "exact" ? "точно" : "≈ оценка",
    tokens:
      r.mode === "exact"
        ? `${r.used}/${r.saved}`
        : r.overlap
          ? `≈ ${r.used}/${r.saved} (перекрытие)`
          : `${r.used}/${r.saved}`,
  }));
}

// По-слойная сводка для обзора — оборачивает layerSummary (см. dashboard/layers.ts).
export function layerSummaryLines(data: WorkspaceData) {
  return layerSummary(data);
}

// Строки «Ленты» (LP10): display-обёртка над buildTimeline. Порядок (новые сверху) и
// набор источников приходят из buildTimeline; здесь добавляем стабильный key (source-ts-i,
// уникальный даже при равном ts) и человекочитаемое when (ISO; "~" — приблизительный ts
// при tsAccuracy="ingest"). Текст token-pilot ("used X, saved Y") приводим к принятому в
// этом файле display-формату "потрачено X · сэкономлено Y"; прочие источники — как есть.
export function timelineRows(
  data: WorkspaceData,
): Array<{ key: string; when: string; source: string; type: string; text: string }> {
  return buildTimeline(data).map((e, i) => {
    let text = e.text;
    if (e.type === "tokens") {
      const m = e.text.match(/used (\d+), saved (\d+)/);
      if (m) text = `потрачено ${m[1]} · сэкономлено ${m[2]}`;
    }
    return {
      key: `${e.source}-${e.ts}-${i}`,
      when: (e.tsAccuracy === "ingest" ? "~" : "") + new Date(e.ts).toISOString(),
      source: e.source,
      type: e.type,
      text,
    };
  });
}

// Ключи реестра — имена, на которые ViewSpec ссылается через {fn,args}.
// Имена соответствуют спеке view-schema.md (раздел «Реестр деривлаций v1»).
export const derivations: Record<string, (data: WorkspaceData, ...args: any[]) => unknown> = {
  sessionsWithTokens,
  tokenTotals,
  taskTitle,
  tokensForTask: tokensForTaskD,
  tokensBySessionForTask: tokensBySessionForTaskD,
  relatedSessions: relatedSessionsD,
  // display-деривации (7.4)
  tokenTotalsLine,
  sessionRows,
  tokenRows,
  taskRows,
  relatedSessionLines,
  taskTokensSummary,
  taskTokenBreakdownLines,
  taskRecordedMetricLine,
  // dashboard-деривации (Task 4)
  tasksWithTokensRows,
  layerSummaryLines,
  // timeline-деривации (LP10)
  timelineRows,
};
