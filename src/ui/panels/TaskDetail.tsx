import React from "react";
import { Box, Text } from "ink";
import { taskDetailFromEvents, tokenMetricsFromEvents, type TjEvent } from "../../core/plugins/task-journal/adapter.js";
import type { SessionRow } from "../../core/plugins/aimux/adapter.js";
import type { TokenUsageRow, TokenEvent } from "../../core/plugins/token-pilot/adapter.js";
import { relatedSessions } from "../../core/metrics/related-sessions.js";
import { tokensForTask, tokensBySessionForTask } from "../../core/metrics/tokens-per-task.js";

export function TaskDetail({
  events,
  id,
  title,
  sessions,
  tokens,
  tokenEvents,
}: {
  events: TjEvent[];
  id: string;
  title: string;
  sessions: SessionRow[];
  tokens: TokenUsageRow[];
  tokenEvents: TokenEvent[];
}) {
  const detail = taskDetailFromEvents(events, id);
  const related = relatedSessions(events, id, sessions, tokens);
  const taskTokens = tokensForTask(events, id, tokenEvents);
  const tokenBreakdown = tokensBySessionForTask(events, id, tokenEvents, sessions);
  const recorded = tokenMetricsFromEvents(events, id);
  const lastRecorded = recorded.length ? recorded[recorded.length - 1] : null;
  const section = (label: string, items: TjEvent[]) => (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{label} ({items.length})</Text>
      {items.length === 0 ? (
        <Text dimColor>  —</Text>
      ) : (
        items.map((e) => (
          <Text key={e.event_id}>  • {e.text.replace(/\s+/g, " ").slice(0, 100)}</Text>
        ))
      )}
    </Box>
  );
  return (
    <Box flexDirection="column">
      <Text bold>{title || id}</Text>
      <Text dimColor>{id}</Text>
      {section("Решения", detail.decisions)}
      {section("Находки", detail.findings)}
      {section("Отвергнутое", detail.rejections)}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Вероятно связанные сессии ({related.length}) <Text dimColor>(эвристика по времени)</Text></Text>
        {related.length === 0 ? (
          <Text dimColor>  —</Text>
        ) : (
          related.map((r) => (
            <Text key={r.sessionId}>  • {r.sessionId.slice(0, 8)} · {r.profile || "—"} · {r.used}/{r.saved}</Text>
          ))
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Токены задачи</Text>
        <Text>  потрачено {taskTokens.used} · сэкономлено {taskTokens.saved}</Text>
        {tokenBreakdown.length === 0 ? (
          <Text dimColor>  нет данных по токенам в окне задачи</Text>
        ) : (
          tokenBreakdown.map((r) => (
            <Text key={r.sessionId}>  • {r.profile} · {r.sessionId.slice(0, 8)} — {r.used}/{r.saved}</Text>
          ))
        )}
        {lastRecorded && (
          <Text dimColor>  в журнале записано: потрачено {lastRecorded.used} · сэкономлено {lastRecorded.saved}</Text>
        )}
      </Box>
      <Text dimColor>{"\n"}Esc — назад к списку</Text>
    </Box>
  );
}
