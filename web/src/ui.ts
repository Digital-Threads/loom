// Small pure UI helpers shared by components (testable without DOM).

export function statusLabel(status: string): string {
  return (
    {
      created: "создана",
      running: "идёт",
      wait: "ждёт",
      done: "готово",
      active: "идёт",
      pending: "ждёт",
      skipped: "пропуск",
      failed: "ошибка",
    }[status] ?? status
  );
}

export function statusClass(status: string): string {
  if (status === "running" || status === "active") return "run";
  if (status === "wait" || status === "pending" || status === "needs_input") return "wait";
  if (status === "done") return "done";
  return "";
}

export function stageStateClass(status: string): string {
  if (status === "done") return "done";
  if (status === "active") return "active2";
  if (status === "pending") return "wait";
  if (status === "skipped") return "skipped";
  return "";
}

export function stageIcon(status: string): string {
  return { done: "✓", active: "●", pending: "!", skipped: "–" }[status] ?? "○";
}
