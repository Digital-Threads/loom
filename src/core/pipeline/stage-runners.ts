// L12 — the dialog stages (Analysis / Brainstorm / Spec). Unlike L4's autonomous
// step DAG, these are human-in-the-loop: an agent classifies/asks/drafts, the
// human steers, and the output is an artifact that feeds the next stage. The
// agent call is injected (StageAgent) so the logic is testable without a model.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { STAGE_KEYS } from "../store/db.js";
import {
  createArtifact,
  latestArtifact,
  setArtifactStatus,
  appendChatMessage,
  getChatMessages,
  type ArtifactRow,
} from "../store/artifacts.js";

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
  if (parsed.route.length) {
    db.prepare("UPDATE tasks SET route = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(parsed.route),
      Date.now(),
      taskId,
    );
  }
  return parsed;
}

export function analysisPrompt(spec: string): string {
  return [
    "Analyze this task for a developer who will READ your analysis.",
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
export async function draftSpec(db: Database.Database, taskId: string, agent: StageAgent): Promise<ArtifactRow> {
  const summary = latestArtifact(db, taskId, "brainstorm-summary")?.content ?? "";
  const md = await agent(`Write an SDD (markdown) for this brief:\n\n${summary}`);
  return createArtifact(db, { id: id("art"), taskId, stage: "spec", kind: "spec-md", content: md });
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
