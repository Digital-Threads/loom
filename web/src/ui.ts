// Small pure UI helpers shared by components (testable without DOM).

export function statusLabel(status: string): string {
  return (
    {
      created: "new",
      running: "running",
      wait: "pending",
      done: "done",
      active: "current",
      pending: "pending",
      skipped: "skipped",
      failed: "failed",
    }[status] ?? status
  );
}

export function statusClass(status: string): string {
  if (status === "running" || status === "active") return "run";
  if (status === "wait" || status === "pending" || status === "needs_input") return "wait";
  if (status === "done") return "done";
  return "";
}

export function stageStateClass(status: string): string {
  if (status === "done") return "done";
  if (status === "active") return "active2";
  if (status === "pending") return "wait";
  if (status === "skipped") return "skipped";
  return "";
}

export function stageIcon(status: string): string {
  return { done: "✓", active: "●", pending: "", skipped: "–" }[status] ?? "";
}

// ─── Cost summary ────────────────────────────────────────────────────────────
// The raw cost_rollups rows (token-pilot/used, token-pilot/saved, aimux/spent)
// are flat and unreadable. Fold them into a primary spend figure + a token
// breakdown so the Cost bar reads at a glance. `exact=0` rows are estimates.

export interface CostRowLike {
  source: string;
  metric: string;
  value: number;
  exact: number;
}

export interface CostSummary {
  spend: string | null; // real money, e.g. "$0.42"
  spendEstimate: boolean;
  tokens: { used: string; saved: string; savedPct: number } | null;
  tokensEstimate: boolean;
  other: { label: string; value: string; estimate: boolean }[];
  empty: boolean;
}

export function formatTokens(n: number): string {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000, n >= 10_000_000)}M`;
  if (n >= 1_000) return `${trimZero(n / 1_000, n >= 10_000)}k`;
  return String(Math.round(n));
}

function trimZero(n: number, whole: boolean): string {
  return whole ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");
}

export function formatUsd(n: number): string {
  if (!isFinite(n) || n <= 0) return "$0.00";
  return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
}

export function summarizeCosts(costs: CostRowLike[]): CostSummary {
  const find = (source: string, metric: string) =>
    costs.find((c) => c.source === source && c.metric === metric);
  const spent = find("aimux", "spent");
  const used = find("token-pilot", "used");
  const saved = find("token-pilot", "saved");

  const known = new Set(["aimux:spent", "token-pilot:used", "token-pilot:saved"]);
  const other = costs
    // hide per-session aimux spend rows (spent:<sid>) — internal to the
    // cross-session accumulation; the "spent" aggregate already represents them.
    .filter((c) => !known.has(`${c.source}:${c.metric}`) && !(c.source === "aimux" && c.metric.startsWith("spent:")))
    .map((c) => ({ label: `${c.source}/${c.metric}`, value: String(c.value), estimate: c.exact === 0 }));

  let tokens: CostSummary["tokens"] = null;
  if (used || saved) {
    const u = used?.value ?? 0;
    const s = saved?.value ?? 0;
    const total = u + s;
    tokens = {
      used: formatTokens(u),
      saved: formatTokens(s),
      savedPct: total > 0 ? Math.round((s / total) * 100) : 0,
    };
  }

  return {
    spend: spent ? formatUsd(spent.value) : null,
    spendEstimate: spent?.exact === 0,
    tokens,
    tokensEstimate: used?.exact === 0 || saved?.exact === 0,
    other,
    empty: !spent && !used && !saved && other.length === 0,
  };
}

// ─── Live stream grouping ────────────────────────────────────────────────────
// The agent's live output interleaves prose with tool calls rendered as
// "→ Tool: arg" lines (live-session.ts). Rendering them raw spams the log with
// "→ Read: …" repeats. Fold consecutive calls of the same tool into one
// collapsible group; keep prose as text blocks, order preserved.

export type StreamItem =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; count: number; calls: string[] };

const TOOL_LINE = /^→\s+([^:]+?)(?::\s*(.*))?$/;

export function groupLiveStream(lines: string[]): StreamItem[] {
  const out: StreamItem[] = [];
  for (const line of lines.join("\n").split("\n")) {
    const m = TOOL_LINE.exec(line);
    if (m) {
      const tool = m[1].trim();
      const arg = (m[2] ?? "").trim();
      const last = out[out.length - 1];
      if (last && last.kind === "tool" && last.tool === tool) {
        last.count++;
        if (arg) last.calls.push(arg);
      } else {
        out.push({ kind: "tool", tool, count: 1, calls: arg ? [arg] : [] });
      }
    } else {
      const last = out[out.length - 1];
      if (last && last.kind === "text") last.text += `\n${line}`;
      else out.push({ kind: "text", text: line });
    }
  }
  return out;
}
