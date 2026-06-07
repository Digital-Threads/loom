import type { ViewSpec } from "../../core/plugins/types.js";

// Host-вкладки (не плагинные). Обзор и Настройки определены как ViewSpec и рисуются
// тем же ViewRenderer, что и плагинные виды. Воспроизводят OverviewPanel/SettingsPanel.

// OverviewPanel: "Подписок: N", "Сессий: N", "Ошибок загрузки: N" (красным, только если >0).
export const overviewView: ViewSpec = {
  kind: "summary",
  lines: [
    { label: "Подписок", value: "subscriptions.length" },
    { label: "Сессий", value: "sessions.length" },
    { label: "Ошибок загрузки", value: "errors.length", color: "red", when: "errors.length" },
  ],
};

// SettingsPanel: форма читает loomRegistry (FormView сам это делает).
export const settingsView: ViewSpec = {
  kind: "form",
  source: "registry-settings",
};

// Cross-layer таблица «задачи + токены» (LP4). Источник — tasksWithTokensRows
// (деривация Task 4): строки с готовым полем tokens ("used/saved" или "≈ … (перекрытие)").
// TableView не имеет поля note → честная пометка о точности вложена в empty:
// токены — оценка по времени (не точный учёт), а «≈ перекрытие» = окна задач
// наложились (double-count), чтобы число не читалось как факт.
// onSelect переиспользует существующий detail-вид taskDetail (task-journal адаптер).
export const tasksTokensView: ViewSpec = {
  kind: "table",
  source: { fn: "tasksWithTokensRows" },
  rowKey: "id",
  empty:
    "Нет задач (токены — оценка по времени, не точный учёт; при наложении задач — «≈ перекрытие», double-count)",
  selectable: true,
  onSelect: { openView: "taskDetail", passId: "id" },
  columns: [
    { value: "title", width: 50, marker: { when: "status", equals: "closed", truthy: "✓", falsy: "○" } },
    { header: "Токены (оценка)", value: "tokens", align: "right" },
  ],
};
