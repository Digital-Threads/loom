// L12 — the dialog stages (Analysis / Brainstorm / Spec). Unlike L4's autonomous
// step DAG, these are human-in-the-loop: an agent classifies/asks/drafts, the
// human steers, and the output is an artifact that feeds the next stage. The
// agent call is injected (StageAgent) so the logic is testable without a model.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { STAGE_KEYS, getStages, updateStageStatus } from "../store/db.js";
import { setSetting } from "../store/settings.js";
import {
  createArtifact,
  latestArtifact,
  setArtifactStatus,
  appendChatMessage,
  getChatMessages,
  type ArtifactRow,
} from "../store/artifacts.js";
import { runTextSwarm } from "../layers/swarm/text-swarm.js";
import { perspectivePrompt } from "../layers/swarm/discrete-swarm.js";

export type StageAgent = (prompt: string) => Promise<string>;

const id = (p: string) => `${p}_${randomBytes(6).toString("hex")}`;
const KEYS = new Set<string>(STAGE_KEYS);

// ─── L12.1 Analysis ───────────────────────────────────────────────────────────
export interface AnalysisResult {
  class: string;
  route: string[];
}

/** Classify a task + propose an adaptive route; persist as an artifact and set
 *  tasks.route (validated against STAGE_KEYS). The agent returns JSON. */
export async function runAnalysis(
  db: Database.Database,
  taskId: string,
  spec: string,
  agent: StageAgent,
): Promise<AnalysisResult> {
  const raw = await agent(analysisPrompt(spec));
  const parsed = parseAnalysis(raw);
  // store the agent's full readable analysis (the user reads this), not just the
  // parsed class/route — the route is derived from the JSON line at the end.
  createArtifact(db, { id: id("art"), taskId, stage: "analysis", kind: "analysis", content: raw });
  // Persist the class so downstream stages can scale to it (e.g. the review stage
  // runs fewer reviewers for a trivial chore) — loom-ohky.
  setSetting(db, `analysis.class.${taskId}`, parsed.class);
  if (parsed.route.length) {
    db.prepare("UPDATE tasks SET route = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(parsed.route),
      Date.now(),
      taskId,
    );
    // Reconcile the stage rows to the new route: stages dropped from the route are
    // marked "skipped" so the engine's pending-walk (completeStage/currentStage)
    // passes over them. The rows were seeded from the creation-time route (often
    // the full pipeline), so without this the adaptive re-route is cosmetic — the
    // pipeline would still run the dropped stages (loom-kk00). Done stages are
    // left as-is; only not-yet-run, no-longer-in-route stages are skipped.
    const keep = new Set(parsed.route);
    for (const s of getStages(db, taskId)) {
      if (!keep.has(s.stage_key) && s.status !== "done" && s.status !== "skipped") {
        updateStageStatus(db, taskId, s.stage_key, "skipped");
      }
    }
  }
  return parsed;
}

export function analysisPrompt(spec: string): string {
  return [
    "Analyze this task for a developer who will READ your analysis.",
    "Ground it in the ACTUAL codebase — don't guess: use token-pilot",
    "(project_overview / explore_area / find_usages) to locate where it lands, and",
    "delegate a deep read to the `code-analyzer` agent if it spans many files.",
    "To map the structure use project_overview / explore_area / Glob — NOT a raw",
    "recursive `find`/`grep` (those are blocked to keep context lean; bound them",
    "with -maxdepth / | head if you must shell out).",
    "Write a short, clear analysis in plain language:",
    "- what the task actually is (in your words),",
    "- where in the codebase it likely lands (files/areas),",
    "- what's involved and any risks or open questions.",
    "",
    "Then, on the LAST line ONLY, output the machine routing as compact JSON:",
    `{ "class": "feature|bug|chore", "route": [${STAGE_KEYS.map((s) => `"${s}"`).join(", ")}] }`,
    "(a bug may skip brainstorm/spec/rd). The prose is for the human; the final JSON line is for the pipeline.",
    "",
    "TASK:",
    spec,
  ].join("\n");
}

export function parseAnalysis(text: string): AnalysisResult {
  // take the LAST flat {...} that carries "class" — so prose with braces above
  // it doesn't break parsing.
  const objs = text.match(/\{[^{}]*\}/g) ?? [];
  const cand = [...objs].reverse().find((o) => o.includes('"class"'));
  if (!cand) return { class: "feature", route: [...STAGE_KEYS] };
  try {
    const o = JSON.parse(cand) as { class?: unknown; route?: unknown };
    const route = Array.isArray(o.route) ? o.route.filter((s): s is string => typeof s === "string" && KEYS.has(s)) : [];
    return {
      class: typeof o.class === "string" ? o.class : "feature",
      route: route.length ? route : [...STAGE_KEYS],
    };
  } catch {
    return { class: "feature", route: [...STAGE_KEYS] };
  }
}

// ─── L12.2 Brainstorm (chat, one question at a time) ──────────────────────────
/** Append the user's message (if any) and get the agent's next question; both
 *  land in chat_messages so the conversation resumes by replay. */
export async function brainstormTurn(
  db: Database.Database,
  taskId: string,
  agent: StageAgent,
  userMessage?: string,
): Promise<string> {
  if (userMessage) {
    appendChatMessage(db, { id: id("msg"), taskId, stage: "brainstorm", role: "user", content: userMessage });
  }
  const history = getChatMessages(db, taskId, "brainstorm")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const question = (await agent(brainstormPrompt(history))).trim();
  appendChatMessage(db, { id: id("msg"), taskId, stage: "brainstorm", role: "agent", content: question });
  return question;
}

/** The agent emits this (as its whole reply) once it has enough to write the
 *  spec — the UI watches for it to offer "move to spec". */
export const BRAINSTORM_READY = "READY";

export function brainstormPrompt(history: string): string {
  return [
    "You are running a brainstorming dialog, ONE question at a time.",
    "Lean on the `brainstorming` skill's technique — surface hidden",
    "assumptions, weigh 2-3 approaches — but keep THIS one-question-at-a-time flow.",
    "Ask the single most useful next question to pin down the task.",
    "When you already have ENOUGH to write a clear spec, do NOT ask another question —",
    `instead reply with exactly: ${BRAINSTORM_READY} — <one short sentence on why it's clear enough>.`,
    "Keep the dialog short: stop as soon as the goal, scope and constraints are clear.",
    "Return only the question (or the READY line), no preamble.",
    "",
    "CONVERSATION:",
    history || "(empty)",
  ].join("\n");
}

/** Summarise the brainstorm transcript into an accepted brainstorm-summary. */
export async function summarizeBrainstorm(
  db: Database.Database,
  taskId: string,
  agent: StageAgent,
): Promise<ArtifactRow> {
  const transcript = getChatMessages(db, taskId, "brainstorm").map((m) => `${m.role}: ${m.content}`).join("\n");
  const summary = await agent(`Summarise this brainstorm into a concise requirements brief:\n\n${transcript}`);
  return createArtifact(db, {
    id: id("art"),
    taskId,
    stage: "brainstorm",
    kind: "brainstorm-summary",
    content: summary,
    status: "accepted",
  });
}

// ─── L12.2b Autopilot brainstorm (self-driven Q&A) ────────────────────────────
/** The auto-answer emits this (as its whole reply) when a question is a genuine
 *  blocker that cannot be resolved from the description + analysis — the runner
 *  parks the stage for a human instead of guessing. */
export const BRAINSTORM_BLOCKED = "BLOCKED";
/** Cap on auto Q&A rounds, so a model that never says READY can't loop (and burn
 *  budget) forever — we summarise with what we have and move on. */
export const BRAINSTORM_MAX_ROUNDS = 5;

/** Prompt the agent to answer its own brainstorm question from the task context,
 *  recording the assumptions it commits to into task-journal. */
export function autoAnswerPrompt(spec: string, analysis: string, question: string): string {
  return [
    "You are auto-answering a brainstorming question in AUTOPILOT — there is no human to ask.",
    "Answer the QUESTION using ONLY the TASK and ANALYSIS below.",
    "Whenever you settle an open point by assuming something, RECORD that assumption in",
    "task-journal as a `decision` (a choice you made) or `finding` (a fact you verified).",
    "Only when the question is a REAL blocker you cannot resolve from the context —",
    "answering it wrong would change the task's goal or scope — reply with exactly:",
    `${BRAINSTORM_BLOCKED} — <one short sentence on what's missing>.`,
    "Otherwise reply with the answer (the accepted assumption), no preamble.",
    "",
    "TASK:",
    spec || "(none)",
    "",
    "ANALYSIS:",
    analysis || "(none)",
    "",
    "QUESTION:",
    question,
  ].join("\n");
}

export interface AutoBrainstormResult {
  blocked: boolean;
  note?: string;
}

/** Detect the blocker sentinel in an auto-answer and return its reason (or null
 *  when not blocked). Matches the BLOCKED marker case-insensitively as the start
 *  of ANY line, but only when it stands alone or is followed by a separator
 *  (— : -). Line-anchored + separator-gated so a real blocker phrased on its own
 *  line still parks, while a normal assumption that merely begins with the word
 *  "blocked …" (e.g. "Blocked tasks are retried") does NOT false-park. */
function blockerNote(reply: string): string | null {
  for (const line of reply.split("\n")) {
    const m = line.trim().match(/^BLOCKED\b\s*(?:[—:-]\s*(.*))?$/i);
    if (m) return (m[1] ?? "").trim() || "blocked on a question that can't be resolved from context";
  }
  return null;
}

/** Autopilot brainstorm: the agent asks itself clarifying questions (reusing the
 *  manual brainstormPrompt) and answers them from the task + analysis, logging
 *  accepted assumptions to task-journal. It parks (blocked) only on a genuine
 *  blocker; otherwise it summarises the transcript exactly like the manual flow. */
export async function runAutoBrainstorm(
  db: Database.Database,
  taskId: string,
  agent: StageAgent,
  ctx: { spec: string; analysis: string },
): Promise<AutoBrainstormResult> {
  for (let round = 0; round < BRAINSTORM_MAX_ROUNDS; round++) {
    const question = await brainstormTurn(db, taskId, agent);
    if (question.startsWith(BRAINSTORM_READY)) break; // enough context to write the spec
    const answer = (await agent(autoAnswerPrompt(ctx.spec, ctx.analysis, question))).trim();
    const note = blockerNote(answer);
    if (note) return { blocked: true, note };
    // the auto-answer lands as the "user" turn, so the next question sees it in
    // history and summarizeBrainstorm / the manual transcript both pick it up.
    appendChatMessage(db, { id: id("msg"), taskId, stage: "brainstorm", role: "user", content: answer });
  }
  await summarizeBrainstorm(db, taskId, agent);
  return { blocked: false };
}

// ─── L12.3 Spec (draft → edit / return-with-comment → accept) ─────────────────
/** Draft a spec from the brainstorm summary (new spec-md artifact, draft). */
function specPrompt(summary: string): string {
  return [
    "Write a clear SDD (software design document, markdown) for this brief.",
    "Use the `writing-plans` skill's approach to make it implementable.",
    "Cover: goal, scope (and explicit NON-goals), the design/approach, the data and",
    "control flow, edge cases, and concrete acceptance criteria a reviewer can check.",
    "Surface the weak assumptions — anything that, if wrong, breaks the plan — and",
    "resolve or flag each. A cheaper implementation model will FOLLOW this spec, so",
    "it must be airtight and unambiguous, not aspirational.",
    "",
    "BRIEF:",
    summary,
  ].join("\n");
}

const SPEC_JUDGE_PROMPT = [
  "You are judging candidate SDDs (software design documents) written for the SAME brief.",
  "Pick the ONE best: airtight and unambiguous, correct scope (incl. explicit non-goals),",
  "implementable AS-IS by a cheaper model, with concrete acceptance criteria — not the",
  "longest or the most aspirational.",
  "Answer with the winner's number (1-based) on the FIRST line, then one short sentence why.",
].join("\n");

export async function draftSpec(db: Database.Database, taskId: string, agent: StageAgent): Promise<ArtifactRow> {
  const summary = latestArtifact(db, taskId, "brainstorm-summary")?.content ?? "";
  const md = await agent(specPrompt(summary));
  return createArtifact(db, { id: id("art"), taskId, stage: "spec", kind: "spec-md", content: md });
}

/** Spec-as-swarm (loom-dmha): draft N candidate SDDs under different lenses, then an
 *  LLM judge elects the best — persisted as the spec artifact. `agent` MUST be a
 *  fresh one-shot agent (a new session per call), NOT a lane-resuming one, since the
 *  N attempts run in parallel and would otherwise race on one session. Returns null
 *  when no candidate was produced, so the caller falls back to a single draftSpec. */
export async function draftSpecSwarm(
  db: Database.Database,
  taskId: string,
  agent: StageAgent,
  cfg: { attempts: number; perspectives?: string[] },
): Promise<ArtifactRow | null> {
  const summary = latestArtifact(db, taskId, "brainstorm-summary")?.content ?? "";
  const result = await runTextSwarm(
    cfg,
    (_i, perspective) => agent(perspectivePrompt(specPrompt(summary), perspective)),
    (candidates) =>
      agent(`${SPEC_JUDGE_PROMPT}\n\n${candidates.map((c, i) => `### Candidate ${i + 1}\n${c.slice(0, 4000)}`).join("\n\n")}`),
  );
  if (!result) return null;
  return createArtifact(db, { id: id("art"), taskId, stage: "spec", kind: "spec-md", content: result.winner });
}

/** Return the spec with a comment → the agent revises into a NEW version. */
export async function reviseSpec(
  db: Database.Database,
  taskId: string,
  comment: string,
  agent: StageAgent,
): Promise<ArtifactRow> {
  const current = latestArtifact(db, taskId, "spec-md")?.content ?? "";
  const md = await agent(`Revise this SDD per the comment.\n\nCOMMENT:\n${comment}\n\nSDD:\n${current}`);
  return createArtifact(db, { id: id("art"), taskId, stage: "spec", kind: "spec-md", content: md, status: "returned" });
}

/** Accept the latest spec → marks it accepted (feeds R&D). Returns it or null. */
export function acceptSpec(db: Database.Database, taskId: string): ArtifactRow | null {
  const latest = latestArtifact(db, taskId, "spec-md");
  if (!latest) return null;
  setArtifactStatus(db, latest.id, "accepted");
  return { ...latest, status: "accepted" };
}
