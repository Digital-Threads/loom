// L12 store — artifacts (stage outputs that flow stage→stage) and chat_messages
// (the brainstorm transcript). Plain CRUD over the core store.
import type Database from "better-sqlite3";

export interface ArtifactRow {
  id: string;
  task_id: string;
  stage: string;
  kind: string;
  content: string;
  version: number;
  status: string;
  created_at: number;
}

export interface CreateArtifactInput {
  id: string;
  taskId: string;
  stage: string;
  kind: string;
  content: string;
  version?: number;
  status?: string;
}

export function createArtifact(db: Database.Database, input: CreateArtifactInput): ArtifactRow {
  const now = Date.now();
  const version = input.version ?? nextVersion(db, input.taskId, input.kind);
  db.prepare(
    `INSERT INTO artifacts (id, task_id, stage, kind, content, version, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.taskId, input.stage, input.kind, input.content, version, input.status ?? "draft", now);
  return getArtifact(db, input.id)!;
}

function nextVersion(db: Database.Database, taskId: string, kind: string): number {
  const row = db
    .prepare("SELECT MAX(version) AS v FROM artifacts WHERE task_id = ? AND kind = ?")
    .get(taskId, kind) as { v: number | null };
  return (row.v ?? 0) + 1;
}

export function getArtifact(db: Database.Database, id: string): ArtifactRow | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
}

export function getArtifacts(db: Database.Database, taskId: string): ArtifactRow[] {
  return db
    .prepare("SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC")
    .all(taskId) as ArtifactRow[];
}

/** The newest version of a kind for a task (or undefined). */
export function latestArtifact(db: Database.Database, taskId: string, kind: string): ArtifactRow | undefined {
  return db
    .prepare("SELECT * FROM artifacts WHERE task_id = ? AND kind = ? ORDER BY version DESC LIMIT 1")
    .get(taskId, kind) as ArtifactRow | undefined;
}

export function setArtifactStatus(db: Database.Database, id: string, status: string): void {
  db.prepare("UPDATE artifacts SET status = ? WHERE id = ?").run(status, id);
}

export interface ChatMessageRow {
  id: string;
  task_id: string;
  stage: string;
  role: string;
  content: string;
  created_at: number;
}

export function appendChatMessage(
  db: Database.Database,
  input: { id: string; taskId: string; stage: string; role: string; content: string },
): ChatMessageRow {
  const now = Date.now();
  db.prepare(
    "INSERT INTO chat_messages (id, task_id, stage, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(input.id, input.taskId, input.stage, input.role, input.content, now);
  return db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(input.id) as ChatMessageRow;
}

export function getChatMessages(db: Database.Database, taskId: string, stage: string): ChatMessageRow[] {
  return db
    .prepare("SELECT * FROM chat_messages WHERE task_id = ? AND stage = ? ORDER BY rowid ASC")
    .all(taskId, stage) as ChatMessageRow[];
}
