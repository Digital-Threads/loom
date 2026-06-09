import type { ViewSpec } from "../../core/plugins/types.js";

// Host tabs (not plugin ones). Overview and Settings are defined as ViewSpec and drawn
// by the same ViewRenderer as plugin views. They reproduce OverviewPanel/SettingsPanel.

// OverviewPanel: "Subscriptions: N", "Sessions: N", "Load errors: N" (in red, only if >0).
// Composite view (ViewSpec[]): summary totals (as before) + a per-layer summary (LP4) --
// one line per present layer from the layerSummaryLines derivation. Rendered as a
// list top-to-bottom by the same ViewRenderer (asArray). The table is NOT selectable and has no
// onSelect -> it does not intercept tab navigation (findInteractive ignores it),
// idParam is not required.
export const overviewView: ViewSpec[] = [
  {
    kind: "summary",
    lines: [
      { label: "Subscriptions", value: "subscriptions.length" },
      { label: "Sessions", value: "sessions.length" },
      { label: "Load errors", value: "errors.length", color: "red", when: "errors.length" },
    ],
  },
  {
    kind: "table",
    source: { fn: "layerSummaryLines" },
    rowKey: "text",
    empty: "No active layers",
    columns: [{ value: "text" }],
  },
];

// SettingsPanel: the form reads loomRegistry (FormView does this itself).
export const settingsView: ViewSpec = {
  kind: "form",
  source: "registry-settings",
};

// Cross-layer "tasks + tokens" table (LP4). Source -- tasksWithTokensRows
// (Task 4 derivation): rows with a ready tokens field ("used/saved" or "~ ... (overlap)").
// TableView has no note field -> the honest accuracy note is embedded in empty:
// tokens -- a time-based estimate (not exact accounting), and "~ overlap" = task windows
// overlapped (double-count), so the number is not read as fact.
// onSelect reuses the existing detail view taskDetail (task-journal adapter).
export const tasksTokensView: ViewSpec = {
  kind: "table",
  source: { fn: "tasksWithTokensRows" },
  rowKey: "id",
  empty:
    "No tasks (tokens are time-based estimates, not exact accounting; when tasks overlap — \"≈ overlap\", double-count)",
  selectable: true,
  onSelect: { openView: "taskDetail", passId: "id" },
  columns: [
    { value: "title", width: 50, marker: { when: "status", equals: "closed", truthy: "✓", falsy: "○" } },
    { header: "Accuracy", value: "badge", width: 10 },
    { header: "Tokens (est.)", value: "tokens", align: "right" },
  ],
};

// "Timeline" (LP10): a single chronology of all layers. Source -- the timelineRows derivation
// (a wrapper over buildTimeline): newest first, "~" in when -- an approximate ts (ingest).
// Columns are coerced to the Column contract (value/width/header). gap=2 -- TableView default.
export const timelineView: ViewSpec = {
  kind: "table",
  source: { fn: "timelineRows" },
  rowKey: "key",
  gap: 2,
  empty: "Timeline is empty",
  columns: [
    { value: "when" },
    { value: "source", width: 12 },
    { value: "type", width: 10 },
    { value: "text" },
  ],
};
