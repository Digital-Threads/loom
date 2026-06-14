// D5.4 — tracker import connector contract. A connector turns an external
// tracker's items into TaskDrafts the host creates on the board.
export interface TaskDraft {
  title: string;
  description?: string;
}

export interface Connector {
  id: string;
  /** Pull open items as drafts. Defensive: failure → []. */
  import(): TaskDraft[];
}
