// D5.4 — tracker import connector contract. A connector turns an external
// tracker's items into TaskDrafts the host creates on the board.
export interface TaskDraft {
  title: string;
  description?: string;
  /** Stable id of the source item (e.g. the bd issue id). Used to make import
   *  idempotent: a draft whose externalId already has a task is skipped. */
  externalId?: string;
}

export interface Connector {
  id: string;
  /** Pull open items as drafts. Defensive: failure → []. */
  import(): TaskDraft[];
}
