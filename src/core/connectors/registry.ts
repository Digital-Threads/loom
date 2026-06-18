// D5.5 — connector registry: the single source of truth for which tracker
// connectors exist. The runtime picks one by id; the UI renders the selector
// from the same list (via GET /api/connectors).
import type { Connector } from "./connector.js";
import { beadsConnector } from "./beads.js";
import { githubConnector } from "./github.js";

export interface ConnectorMeta {
  /** Stable id used to select the connector. */
  id: string;
  /** Human label for the UI selector. */
  label: string;
  /** Whether a repository ("owner/repo") must be supplied for import. */
  needsRepo: boolean;
}

export const CONNECTORS: ConnectorMeta[] = [
  { id: "beads", label: "beads", needsRepo: false },
  { id: "github", label: "GitHub Issues", needsRepo: true },
];

/** Build the connector for the given id, or undefined for an unknown id. */
export function selectConnector(id: string, opts?: { repo?: string }): Connector | undefined {
  switch (id) {
    case "beads":
      return beadsConnector();
    case "github":
      return githubConnector({ repo: opts?.repo ?? "" });
    default:
      return undefined;
  }
}
