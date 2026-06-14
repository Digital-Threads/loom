// D6 — task attachments (files/screens/links). Stored as metadata rows; file
// blobs live under ~/.loom/state/<projectId>/attachments/<taskId>/. At run time
// the conductor/executor copies files into the worktree and lists them in the
// step prompt.
import type Database from "better-sqlite3";

export interface AttachmentRow {
  id: string;
  task_id: string;
  kind: string; // file | link
  name: string;
  path_or_url: string;
  created_at: number;
}

export function addAttachment(
  db: Database.Database,
  input: { id: string; taskId: string; kind: "file" | "link"; name: string; pathOrUrl: string },
): AttachmentRow {
  const now = Date.now();
  db.prepare(
    "INSERT INTO attachments (id, task_id, kind, name, path_or_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(input.id, input.taskId, input.kind, input.name, input.pathOrUrl, now);
  return db.prepare("SELECT * FROM attachments WHERE id = ?").get(input.id) as AttachmentRow;
}

export function getAttachments(db: Database.Database, taskId: string): AttachmentRow[] {
  return db
    .prepare("SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(taskId) as AttachmentRow[];
}
