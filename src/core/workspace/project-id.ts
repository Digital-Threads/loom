import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Резолв корня проекта: git-toplevel от кандидата, иначе кандидат как есть.
export function resolveProjectRoot(candidate: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: candidate,
      encoding: "utf8",
      timeout: 3000,
    });
    const top = out.trim();
    return top || candidate;
  } catch {
    return candidate;
  }
}

// Собственная стабильная метка рабочего пространства Loom. НЕ воспроизводит хеш task-journal.
// Требование — только детерминированность (один корень → один id, 16 hex).
export function deriveProjectId(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
}
