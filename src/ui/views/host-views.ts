import type { ViewSpec } from "../../core/plugins/types.js";

// Host-вкладки (не плагинные). Обзор и Настройки определены как ViewSpec и рисуются
// тем же ViewRenderer, что и плагинные виды. Воспроизводят OverviewPanel/SettingsPanel.

// OverviewPanel: "Подписок: N", "Сессий: N", "Ошибок загрузки: N" (красным, только если >0).
// Составной вид (ViewSpec[]): summary-итоги (как было) + по-слойная сводка (LP4) —
// одна строка на присутствующий слой из деривации layerSummaryLines. Рендерится
// списком сверху вниз тем же ViewRenderer (asArray). Таблица НЕ selectable и без
// onSelect → навигацию вкладки не перехватывает (findInteractive её игнорирует),
// idParam не требуется.
export const overviewView: ViewSpec[] = [
  {
    kind: "summary",
    lines: [
      { label: "Подписок", value: "subscriptions.length" },
      { label: "Сессий", value: "sessions.length" },
      { label: "Ошибок загрузки", value: "errors.length", color: "red", when: "errors.length" },
    ],
  },
  {
    kind: "table",
    source: { fn: "layerSummaryLines" },
    rowKey: "text",
    empty: "Слои не активны",
    columns: [{ value: "text" }],
  },
];

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
    { header: "Точность", value: "badge", width: 10 },
    { header: "Токены (оценка)", value: "tokens", align: "right" },
  ],
};

// «Лента» (LP10): единая хронология всех слоёв. Источник — деривация timelineRows
// (обёртка над buildTimeline): новые сверху, "~" в when — приблизительный ts (ingest).
// Колонки приведены к контракту Column (value/width/header). gap=2 — дефолт TableView.
export const timelineView: ViewSpec = {
  kind: "table",
  source: { fn: "timelineRows" },
  rowKey: "key",
  gap: 2,
  empty: "Лента пуста",
  columns: [
    { value: "when" },
    { value: "source", width: 12 },
    { value: "type", width: 10 },
    { value: "text" },
  ],
};
