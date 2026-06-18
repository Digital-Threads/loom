// D5.4 — beads connector: import open bd issues as task drafts (reference impl).
import { execFileSync } from "node:child_process";
import type { Connector, TaskDraft } from "./connector.js";

export type BdRunner = () => string;

export function beadsConnector(opts: { run?: BdRunner } = {}): Connector {
  const run =
    opts.run ?? (() => execFileSync("bd", ["list", "--status=open", "--json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  return {
    id: "beads",
    import(): TaskDraft[] {
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
        const externalId = typeof i.id === "string" ? i.id : undefined;
        out.push({ title, description: typeof i.description === "string" ? i.description : undefined, externalId });
      }
      return out;
    },
  };
}
