import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenEventsByTime, toolCallTokensForSessions, toolCallUsageBySession } from "../../../../src/core/plugins/token-pilot/adapter.js";

// helper: write a jsonl event
const ev = (o: Record<string, unknown>) => JSON.stringify(o);

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-tp-"));
  dirs.push(d);
  return d;
}

describe("LP13 token-pilot adapter: archives + subtrees + agentType", () => {
  it("reads the current hook-events.jsonl AND the archived hook-events.<ts>.jsonl", () => {
    const root = tmp();
    const tp = join(root, ".token-pilot");
    mkdirSync(tp, { recursive: true });
    writeFileSync(
      join(tp, "hook-events.jsonl"),
      ev({ ts: 2000, session_id: "s", agent_type: null, estTokens: 10, savedTokens: 5, event: "denied" }) + "\n",
    );
    writeFileSync(
      join(tp, "hook-events.1700000000000.jsonl"),
      ev({ ts: 1000, session_id: "s", agent_type: null, estTokens: 7, savedTokens: 3, event: "denied" }) + "\n",
    );
    const out = tokenEventsByTime(root);
    expect(out.map((e) => e.ts).sort((a, b) => a - b)).toEqual([1000, 2000]);
  });

  it("filters out session_id==='diagnostic'", () => {
    const root = tmp();
    const tp = join(root, ".token-pilot");
    mkdirSync(tp, { recursive: true });
    writeFileSync(
      join(tp, "hook-events.jsonl"),
      ev({ ts: 1, session_id: "diagnostic", agent_type: null, estTokens: 1, savedTokens: 0, event: "denied" }) +
        "\n" +
        ev({ ts: 2, session_id: "s", agent_type: null, estTokens: 1, savedTokens: 0, event: "denied" }) +
        "\n",
    );
    expect(tokenEventsByTime(root).map((e) => e.sessionId)).toEqual(["s"]);
  });

  it("walks into .token-pilot in a SUBFOLDER (monorepo)", () => {
    const root = tmp();
    const sub = join(root, "packages", "x", ".token-pilot");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, "hook-events.jsonl"),
      ev({ ts: 5, session_id: "s", agent_type: null, estTokens: 2, savedTokens: 1, event: "denied" }) + "\n",
    );
    expect(tokenEventsByTime(root).some((e) => e.ts === 5)).toBe(true);
  });

  it("does NOT descend into node_modules", () => {
    const root = tmp();
    const nm = join(root, "node_modules", "pkg", ".token-pilot");
    mkdirSync(nm, { recursive: true });
    writeFileSync(
      join(nm, "hook-events.jsonl"),
      ev({ ts: 9, session_id: "s", agent_type: null, estTokens: 1, savedTokens: 0, event: "denied" }) + "\n",
    );
    expect(tokenEventsByTime(root).some((e) => e.ts === 9)).toBe(false);
  });

  it("agentType: subagent → 'subagent', main → null (the field is always present)", () => {
    const root = tmp();
    const tp = join(root, ".token-pilot");
    mkdirSync(tp, { recursive: true });
    writeFileSync(
      join(tp, "hook-events.jsonl"),
      ev({ ts: 1, session_id: "s", agent_type: "subagent", estTokens: 1, savedTokens: 0, event: "denied" }) +
        "\n" +
        ev({ ts: 2, session_id: "s", agent_type: null, estTokens: 1, savedTokens: 0, event: "denied" }) +
        "\n",
    );
    const out = tokenEventsByTime(root);
    const byTs = Object.fromEntries(out.map((e) => [e.ts, e.agentType]));
    expect(byTs[1]).toBe("subagent");
    expect(byTs[2]).toBe(null);
  });

  it("sums MCP tool-call savings from tool-calls.jsonl for the given sessions (loom-cust)", () => {
    const root = tmp();
    const tp = join(root, ".token-pilot");
    mkdirSync(tp, { recursive: true });
    writeFileSync(
      join(tp, "tool-calls.jsonl"),
      ev({ ts: 1, session_id: "s1", tool: "smart_read", tokensReturned: 983, tokensWouldBe: 31588 }) + "\n" +
        ev({ ts: 2, session_id: "s1", tool: "read_symbol", tokensReturned: 311, tokensWouldBe: 31588 }) + "\n" +
        ev({ ts: 3, session_id: "s2", tool: "smart_read", tokensReturned: 100, tokensWouldBe: 5000 }) + "\n",
    );
    writeFileSync(
      join(tp, "tool-calls.1700000000000.jsonl"), // rotated archive is read too
      ev({ ts: 0, session_id: "s1", tool: "find_usages", tokensReturned: 50, tokensWouldBe: 2000 }) + "\n",
    );
    // only s1's calls (current + archive); s2 excluded.
    const r = toolCallTokensForSessions(root, ["s1"]);
    expect(r.used).toBe(983 + 311 + 50); // tokensReturned
    expect(r.saved).toBe((31588 - 983) + (31588 - 311) + (2000 - 50)); // wouldBe − returned
    // multiple sessions sum; an unknown session contributes nothing.
    expect(toolCallTokensForSessions(root, ["s1", "s2"]).used).toBe(983 + 311 + 50 + 100);
    expect(toolCallTokensForSessions(root, ["nope"]).used).toBe(0);
    expect(toolCallTokensForSessions(root, []).used).toBe(0);
  });

  it("groups tool-call usage per session for the Tokens dashboard (loom-tdash)", () => {
    const root = tmp();
    const tp = join(root, ".token-pilot");
    mkdirSync(tp, { recursive: true });
    writeFileSync(
      join(tp, "tool-calls.jsonl"),
      ev({ ts: 1, session_id: "s1", tool: "smart_read", tokensReturned: 983, tokensWouldBe: 31588 }) + "\n" +
        ev({ ts: 2, session_id: "s1", tool: "read_symbol", tokensReturned: 311, tokensWouldBe: 31588 }) + "\n" +
        ev({ ts: 3, session_id: "s2", tool: "smart_read", tokensReturned: 100, tokensWouldBe: 5000 }) + "\n",
    );
    const rows = Object.fromEntries(toolCallUsageBySession(root).map((r) => [r.sessionId, r]));
    expect(rows.s1).toMatchObject({ used: 983 + 311, saved: (31588 - 983) + (31588 - 311) });
    expect(rows.s2).toMatchObject({ used: 100, saved: 5000 - 100 });
  });
});
