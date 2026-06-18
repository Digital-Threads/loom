import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTask } from "../../../src/core/store/db.js";
import { latestArtifact, getChatMessages } from "../../../src/core/store/artifacts.js";
import {
  runAnalysis,
  brainstormTurn,
  summarizeBrainstorm,
  runAutoBrainstorm,
  BRAINSTORM_MAX_ROUNDS,
  draftSpec,
  reviseSpec,
  acceptSpec,
} from "../../../src/core/pipeline/stage-runners.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-sr-"));
  db = openStore(join(dir, "s.db"));
  createTask(db, { id: "t1", title: "Refund" });
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe("L12.1 runAnalysis", () => {
  it("classifies + sets a validated route, persists an artifact", async () => {
    const agent = async () => '{"class":"bug","route":["analysis","impl","review","qa","done","BOGUS"]}';
    const r = await runAnalysis(db, "t1", "fix the refund crash", agent);
    expect(r.class).toBe("bug");
    expect(r.route).toEqual(["analysis", "impl", "review", "qa", "done"]); // BOGUS filtered
    expect(JSON.parse(getTask(db, "t1")!.route!)).toEqual(r.route);
    expect(latestArtifact(db, "t1", "analysis")).toBeDefined();
  });
  it("falls back to the full route on bad agent output", async () => {
    const r = await runAnalysis(db, "t1", "x", async () => "not json");
    expect(r.route.length).toBeGreaterThan(0);
  });
  it("keeps the human prose analysis and parses the trailing JSON line", async () => {
    const out = 'This is a chore: tidy the greet() helper in src/greet.ts. Low risk.\n{ "class": "chore", "route": ["analysis","impl","review","qa","done"] }';
    const r = await runAnalysis(db, "t1", "tidy greet", async () => out);
    expect(r.class).toBe("chore"); // parsed from the trailing JSON
    expect(r.route).toEqual(["analysis", "impl", "review", "qa", "done"]);
    expect(latestArtifact(db, "t1", "analysis")!.content).toContain("tidy the greet()"); // prose stored, not just JSON
  });
});

describe("L12.2 brainstorm", () => {
  it("records user + agent turns and summarises to an accepted artifact", async () => {
    let n = 0;
    const agent = async () => `question ${++n}?`;
    await brainstormTurn(db, "t1", agent); // opening question
    await brainstormTurn(db, "t1", agent, "my answer"); // user reply + next question
    const msgs = getChatMessages(db, "t1", "brainstorm");
    expect(msgs.map((m) => m.role)).toEqual(["agent", "user", "agent"]);
    const summary = await summarizeBrainstorm(db, "t1", async () => "BRIEF");
    expect(summary.kind).toBe("brainstorm-summary");
    expect(summary.status).toBe("accepted");
    expect(latestArtifact(db, "t1", "brainstorm-summary")?.content).toBe("BRIEF");
  });
});

describe("L12.2b autopilot brainstorm (runAutoBrainstorm)", () => {
  // One injected agent serves all three prompt kinds; branch on prompt content.
  const ctx = { spec: "do X", analysis: "lands in foo.ts" };

  it("auto-answers questions, records Q&A turns, summarises and advances", async () => {
    let q = 0;
    const agent = async (prompt: string) => {
      if (prompt.includes("Summarise this brainstorm")) return "BRIEF";
      if (prompt.includes("AUTOPILOT")) return "assume the default";
      return ++q <= 2 ? `question ${q}?` : "READY — enough context";
    };
    const res = await runAutoBrainstorm(db, "t1", agent, ctx);
    expect(res.blocked).toBe(false);
    // two Q&A rounds then a READY question: agent, user, agent, user, agent
    expect(getChatMessages(db, "t1", "brainstorm").map((m) => m.role)).toEqual(["agent", "user", "agent", "user", "agent"]);
    expect(latestArtifact(db, "t1", "brainstorm-summary")?.content).toBe("BRIEF");
  });

  it("parks (blocked) on a genuine blocker without summarising", async () => {
    const agent = async (prompt: string) => {
      if (prompt.includes("AUTOPILOT")) return "BLOCKED — missing external contract";
      if (prompt.includes("Summarise this brainstorm")) return "BRIEF";
      return "question 1?";
    };
    const res = await runAutoBrainstorm(db, "t1", agent, { spec: "x", analysis: "" });
    expect(res.blocked).toBe(true);
    expect(res.note).toContain("missing external contract");
    expect(latestArtifact(db, "t1", "brainstorm-summary")).toBeUndefined(); // not summarised on a park
  });

  it("caps the loop when the agent never says READY, then still summarises", async () => {
    let q = 0;
    const agent = async (prompt: string) => {
      if (prompt.includes("Summarise this brainstorm")) return "BRIEF";
      if (prompt.includes("AUTOPILOT")) return "assume the default";
      return `question ${++q}?`; // never READY
    };
    const res = await runAutoBrainstorm(db, "t1", agent, ctx);
    expect(res.blocked).toBe(false);
    expect(getChatMessages(db, "t1", "brainstorm").filter((m) => m.role === "agent").length).toBe(BRAINSTORM_MAX_ROUNDS);
    expect(latestArtifact(db, "t1", "brainstorm-summary")?.content).toBe("BRIEF");
  });
});

describe("L12.3 spec", () => {
  it("drafts from the summary, revises into a new version, accepts the latest", async () => {
    await summarizeBrainstorm(db, "t1", async () => "the brief");
    const v1 = await draftSpec(db, "t1", async () => "# SDD v1");
    expect(v1.version).toBe(1);
    const v2 = await reviseSpec(db, "t1", "add error handling", async () => "# SDD v2");
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("returned");
    const accepted = acceptSpec(db, "t1");
    expect(accepted?.status).toBe("accepted");
    expect(latestArtifact(db, "t1", "spec-md")?.content).toBe("# SDD v2");
  });
});
