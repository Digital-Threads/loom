// D5.5 — GitHub Issues connector: import a repo's open issues as task drafts via
// the `gh` CLI (self-contained external tool; relies on the user's existing gh
// auth). Mirrors beads.ts: injectable runner, defensive (failure → []).
import { execFileSync } from "node:child_process";
import type { Connector, TaskDraft } from "./connector.js";

export type GhRunner = () => string;

export function githubConnector(opts: { repo: string; run?: GhRunner }): Connector {
  // Normalize the repo (GitHub names are case-insensitive): trim + lowercase so
  // re-importing "Owner/Repo" and "owner/repo" yields the same externalId and
  // the dedup holds instead of creating duplicate tasks.
  const repo = opts.repo.trim().toLowerCase();
  const run =
    opts.run ??
    (() =>
      execFileSync(
        "gh",
        // --limit 1000 is a deliberate ceiling (gh defaults to 30): a single
        // manual import of 1000+ open issues is far past any realistic board.
        ["issue", "list", "--repo", repo, "--state", "open", "--json", "number,title,body", "--limit", "1000"],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      ));
  return {
    id: "github",
    import(): TaskDraft[] {
      // No repo → nothing to import (never shells out).
      if (!repo) return [];
      let arr: unknown;
      try {
        arr = JSON.parse(run());
      } catch {
        return [];
      }
      if (!Array.isArray(arr)) return [];
      const out: TaskDraft[] = [];
      for (const raw of arr) {
        if (!raw || typeof raw !== "object") continue;
        const i = raw as Record<string, unknown>;
        const title = typeof i.title === "string" ? i.title : "";
        if (!title) continue;
        // Namespace the ref so a GitHub issue number can never collide with a
        // bd issue id and corrupt the idempotent-import dedup.
        const externalId = typeof i.number === "number" ? `github:${repo}#${i.number}` : undefined;
        out.push({ title, description: typeof i.body === "string" ? i.body : undefined, externalId });
      }
      return out;
    },
  };
}
