// Typed client for the loom local API. fetch is injectable so the client is
// testable without a server / DOM.

export interface BoardCard {
  id: string;
  title: string;
  stageKey: string;
  status: string;
}
export interface BoardColumn {
  stageKey: string;
  cards: BoardCard[];
}
export interface AttentionItem {
  taskId: string;
  title: string;
  stageKey: string;
}
export interface TaskRow {
  id: string;
  title: string;
  status: string;
  run_mode: string;
  route: string | null;
  repo: string | null;
  branch: string | null;
  description: string | null;
  created_at: number;
  updated_at: number;
}
export interface StageRow {
  task_id: string;
  stage_key: string;
  status: string;
  gate: number;
  started_at: number | null;
  finished_at: number | null;
}
export interface StepRow {
  id: string;
  task_id: string;
  title: string;
  approach: string | null;
  agent: string | null;
  model: string | null;
  profile: string | null;
  depends_on: string | null;
  status: string;
  exit_code: number | null;
}
export interface CostRow {
  task_id: string;
  source: string;
  metric: string;
  value: number;
  exact: number;
}
export interface TaskDetail {
  task: TaskRow;
  stages: StageRow[];
  steps: StepRow[];
  costs: CostRow[];
}

export type Fetcher = typeof fetch;

async function getJson<T>(path: string, f: Fetcher): Promise<T> {
  const res = await f(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export function createClient(base = "", f: Fetcher = fetch) {
  return {
    board: () => getJson<{ columns: BoardColumn[] }>(`${base}/api/board`, f).then((d) => d.columns),
    attention: () => getJson<{ items: AttentionItem[] }>(`${base}/api/attention`, f).then((d) => d.items),
    tasks: () => getJson<{ tasks: TaskRow[] }>(`${base}/api/tasks`, f).then((d) => d.tasks),
    task: (id: string) => getJson<TaskDetail>(`${base}/api/tasks/${id}`, f),
  };
}

export type LoomClient = ReturnType<typeof createClient>;

export const STAGE_LABELS: Record<string, string> = {
  analysis: "Анализ",
  brainstorm: "Брейншторм",
  spec: "Спека",
  rd: "R&D",
  impl: "Реализация",
  review: "Review",
  qa: "QA",
  pr: "PR",
  done: "Done",
};
