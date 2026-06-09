import type { WorkspaceData } from "../data/loader.js";
import { tokenMetricsFromEvents } from "../plugins/task-journal/adapter.js";
import { tokensForTask, tokensBySessionForTask, tasksWithTokens } from "../metrics/tokens-per-task.js";
import { relatedSessions } from "../metrics/related-sessions.js";
import { layerSummary } from "../dashboard/layers.js";
import { buildTimeline } from "../timeline/timeline.js";

// Registry of v1 derivations -- pure functions over WorkspaceData. Cross-plugin joins
// (join sessions+tokens, correlating a task's tokens, etc.) belong to the host, not a plugin:
// after Phase 9 plugins are separate packages and see only their own load() data.
// Each derivation WRAPS an existing metrics/adapter function -- we don't duplicate the logic.

export interface SessionWithTokens {
  sessionId: string;
  profile: string;
  used: number;
  saved: number;
}

// Join data.sessions + data.tokens by sessionId. Ported from inline logic in SessionsPanel.
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

// Totals across all token rows. Ported from the inline reduce in TokensPanel.
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

// -- Display derivations for declarative views (Task 7.4) ----------------------
// They return rows with already-formatted fields for the renderers' columns/sections.
// The pinned derivations above (sessionsWithTokens/tokenTotals/taskDetail*) are NOT touched --
// their shape is frozen by toEqual tests. These display derivations are separate.

// Token total as a single summary line "spent X / saved Y"
// (Bind does not pull a sub-field out of {used,saved}; SummaryView inserts "label: value",
// so the total = one value line under the label "Total" -> "Total: spent X / ...").
export function tokenTotalsLine(data: WorkspaceData): string {
  const t = tokenTotals(data);
  return `spent ${t.used} · saved ${t.saved}`;
}

// Sessions table rows: idShort = slice(0,8), tokens = "used/saved", profileTokens =
// profile.padEnd(12)+" "+tokens -- exact reproduction of the SessionsPanel row at gap=2.
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

// Tokens table rows: idShort = slice(0,8); used/saved -- numbers (padStart in columns).
export function tokenRows(data: WorkspaceData): Array<{ sessionId: string; idShort: string; used: number; saved: number }> {
  return data.tokens.map((t) => ({
    sessionId: t.sessionId,
    idShort: t.sessionId.slice(0, 8),
    used: t.used,
    saved: t.saved,
  }));
}

// Tasks table rows: title truncated to 60 (as in TasksPanel), status for the marker /.
export function taskRows(data: WorkspaceData): Array<{ id: string; title: string; status: string }> {
  return data.tasks.map((t) => ({ id: t.id, title: t.title.slice(0, 60), status: t.status }));
}

// "Likely related sessions" -- {text:"id8 / profile||-- / used/saved"} (as in TaskDetail).
export function relatedSessionLines(data: WorkspaceData, taskId: string): Array<{ sessionId: string; text: string }> {
  return relatedSessions(data.taskEvents, taskId, data.sessions, data.tokens).map((r) => ({
    sessionId: r.sessionId,
    text: `${r.sessionId.slice(0, 8)} · ${r.profile || "—"} · ${r.used}/${r.saved}`,
  }));
}

// Task token total line: "spent X / saved Y" (as in TaskDetail).
export function taskTokensSummary(data: WorkspaceData, taskId: string): string {
  const t = tokensForTask(data.taskEvents, taskId, data.tokenEvents);
  return `spent ${t.used} · saved ${t.saved}`;
}

// Token breakdown by session: {text:"profile / id8 -- used/saved"} (as in TaskDetail).
export function taskTokenBreakdownLines(data: WorkspaceData, taskId: string): Array<{ sessionId: string; text: string }> {
  return tokensBySessionForTask(data.taskEvents, taskId, data.tokenEvents, data.sessions).map((r) => ({
    sessionId: r.sessionId,
    text: `${r.profile} · ${r.sessionId.slice(0, 8)} — ${r.used}/${r.saved}`,
  }));
}

// Last recorded metric: "recorded in the journal: spent X / saved Y" or "".
export function taskRecordedMetricLine(data: WorkspaceData, taskId: string): string {
  const recorded = tokenMetricsFromEvents(data.taskEvents, taskId);
  const last = recorded.length ? recorded[recorded.length - 1] : null;
  return last ? `recorded in journal: spent ${last.used} · saved ${last.saved}` : "";
}

// Tasks table rows with tokens: wraps tasksWithTokens. HONESTY about overlap ->
// the number is inflated (double-count) -> we don't present it as fact, we mark it "~ ... (overlap)".
export function tasksWithTokensRows(data: WorkspaceData) {
  return tasksWithTokens(data.taskEvents, data.tasks, data.tokenEvents).map((r) => ({
    id: r.id,
    title: r.title.slice(0, 50),
    status: r.status,
    used: r.used,
    saved: r.saved,
    overlap: r.overlap,
    mode: r.mode,
    badge: r.mode === "exact" ? "exact" : "≈ estimate",
    tokens:
      r.mode === "exact"
        ? `${r.used}/${r.saved}`
        : r.overlap
          ? `≈ ${r.used}/${r.saved} (overlap)`
          : `${r.used}/${r.saved}`,
  }));
}

// Per-layer summary for the overview -- wraps layerSummary (see dashboard/layers.ts).
export function layerSummaryLines(data: WorkspaceData) {
  return layerSummary(data);
}

// "Timeline" rows (LP10): a display wrapper over buildTimeline. The order (newest first) and
// the set of sources come from buildTimeline; here we add a stable key (source-ts-i,
// unique even when ts is equal) and a human-readable when (ISO; "~" -- an approximate ts
// when tsAccuracy="ingest"). The token-pilot text ("used X, saved Y") is normalized to this
// file's adopted display format "spent X / saved Y"; other sources are left as-is.
export function timelineRows(
  data: WorkspaceData,
): Array<{ key: string; when: string; source: string; type: string; text: string }> {
  return buildTimeline(data).map((e, i) => {
    let text = e.text;
    if (e.type === "tokens") {
      const m = e.text.match(/used (\d+), saved (\d+)/);
      if (m) text = `spent ${m[1]} · saved ${m[2]}`;
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

// Registry keys are the names a ViewSpec references via {fn,args}.
// The names match the view-schema.md spec (section "v1 derivations registry").
export const derivations: Record<string, (data: WorkspaceData, ...args: any[]) => unknown> = {
  sessionsWithTokens,
  tokenTotals,
  taskTitle,
  tokensForTask: tokensForTaskD,
  tokensBySessionForTask: tokensBySessionForTaskD,
  relatedSessions: relatedSessionsD,
  // display derivations (7.4)
  tokenTotalsLine,
  sessionRows,
  tokenRows,
  taskRows,
  relatedSessionLines,
  taskTokensSummary,
  taskTokenBreakdownLines,
  taskRecordedMetricLine,
  // dashboard derivations (Task 4)
  tasksWithTokensRows,
  layerSummaryLines,
  // timeline derivations (LP10)
  timelineRows,
};
