// Small pure UI helpers shared by components (testable without DOM).
import { savedTokensToUsd } from "./pricing";

export function statusLabel(status: string): string {
  return (
    {
      created: "new",
      running: "running",
      waiting: "needs you",
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
  if (status === "waiting") return "wait";
  if (status === "wait" || status === "pending" || status === "needs_input") return "wait";
  if (status === "done") return "done";
  if (status === "failed" || status === "error") return "fail";
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
  tokens: { used: string; saved: string; savedPct: number; savedUsd: string | null } | null;
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

// $ saved label, shared by the per-task bar and the board so they read the same.
// null → nothing saved (caller shows "—" / hides it). Tiny-but-positive amounts
// collapse to "<$0.01" instead of a misleading "$0.0000".
export function savedUsdLabel(savedTokens: number, modelId?: string): string | null {
  const usd = savedTokensToUsd(savedTokens, modelId);
  if (usd <= 0) return null;
  if (usd < 0.01) return "<$0.01";
  return formatUsd(usd);
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
      // $ saved ≈ saved input tokens valued at the default model's input price.
      savedUsd: savedUsdLabel(s),
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

export interface ToolAction { icon: string; label: string }

/** Map a tool call (its name + main arg) to a human action for the live log, so a
 *  reader sees "Reading code" / "Running tests" instead of bare tool names. Pure
 *  and heuristic — order matters (edit before read, since read_for_edit contains
 *  "read"); an unknown tool falls back to its own name. The raw tool name is still
 *  shown next to the label in the UI, so transparency is kept. */
export function toolAction(tool: string, arg = ""): ToolAction {
  const t = tool.toLowerCase();
  const a = arg.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => t.includes(k));
  // Bash/shell — the action lives in the command, not the tool name.
  if (t === "bash" || t === "shell" || t.endsWith("__bash")) {
    if (/\b(test|vitest|jest|pytest|phpunit|cargo test|go test)\b/.test(a)) return { icon: "🧪", label: "Running tests" };
    if (/\b(npm|pnpm|yarn|bun)\s+(install|i|ci|add)\b/.test(a) || a.includes("pip install") || a.includes("cargo install")) return { icon: "📦", label: "Installing dependencies" };
    if (/\b(build|tsc|compile|vite build|webpack)\b/.test(a)) return { icon: "🏗️", label: "Building" };
    if (/\bgit\b/.test(a)) return { icon: "🔧", label: "Working with git" };
    return { icon: "⚙️", label: "Running a command" };
  }
  if (has("read_for_edit") || ["edit", "write", "notebookedit"].includes(t) || has("__edit", "__write")) return { icon: "✏️", label: "Editing files" };
  if (has("read", "outline", "explore", "project_overview", "module_info", "related_files")) return { icon: "📖", label: "Reading code" };
  if (has("grep", "glob", "find_usages", "find_unused", "code_audit") || t.endsWith("search")) return { icon: "🔍", label: "Searching the code" };
  if (has("test_summary")) return { icon: "🧪", label: "Running tests" };
  if (has("smart_diff", "read_diff", "smart_log")) return { icon: "🔧", label: "Inspecting changes" };
  if (has("task_", "event_add", "memory", "journal")) return { icon: "📝", label: "Recording its reasoning" };
  if (t === "todowrite" || has("todo")) return { icon: "✅", label: "Planning the steps" };
  if (has("webfetch", "websearch", "fetch")) return { icon: "🌐", label: "Looking things up" };
  return { icon: "→", label: tool };
}
