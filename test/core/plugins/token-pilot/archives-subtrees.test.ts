import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenEventsByTime } from "../../../../src/core/plugins/token-pilot/adapter.js";

// helper: записать jsonl-событие
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

describe("LP13 token-pilot adapter: архивы + поддеревья + agentType", () => {
  it("читает текущий hook-events.jsonl И архив hook-events.<ts>.jsonl", () => {
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

  it("фильтрует session_id==='diagnostic'", () => {
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

  it("обходит .token-pilot в ПОДПАПКЕ (монорепо)", () => {
    const root = tmp();
    const sub = join(root, "packages", "x", ".token-pilot");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, "hook-events.jsonl"),
      ev({ ts: 5, session_id: "s", agent_type: null, estTokens: 2, savedTokens: 1, event: "denied" }) + "\n",
    );
    expect(tokenEventsByTime(root).some((e) => e.ts === 5)).toBe(true);
  });

  it("НЕ заходит в node_modules", () => {
    const root = tmp();
    const nm = join(root, "node_modules", "pkg", ".token-pilot");
    mkdirSync(nm, { recursive: true });
    writeFileSync(
      join(nm, "hook-events.jsonl"),
      ev({ ts: 9, session_id: "s", agent_type: null, estTokens: 1, savedTokens: 0, event: "denied" }) + "\n",
    );
    expect(tokenEventsByTime(root).some((e) => e.ts === 9)).toBe(false);
  });

  it("agentType: subagent → 'subagent', основной → null (поле всегда присутствует)", () => {
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
});
