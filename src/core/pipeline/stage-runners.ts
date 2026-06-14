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
  createArtifact(db, { id: id("art"), taskId, stage: "analysis", kind: "analysis", content: JSON.stringify(parsed) });
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
    "Classify this task and propose the pipeline route it needs.",
    `Valid stages: ${STAGE_KEYS.join(", ")}.`,
    'Return ONLY JSON: { "class": "feature|bug|chore", "route": ["analysis", ...] }.',
    "A bug may skip brainstorm/spec/rd. No prose.",
    "",
    "TASK:",
    spec,
  ].join("\n");
}

export function parseAnalysis(text: string): AnalysisResult {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { class: "feature", route: [...STAGE_KEYS] };
  try {
    const o = JSON.parse(m[0]) as { class?: unknown; route?: unknown };
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

export function brainstormPrompt(history: string): string {
  return [
    "You are running a brainstorming dialog, ONE question at a time.",
    "Given the conversation so far, ask the single most useful next question.",
    "Return only the question text, no preamble.",
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
