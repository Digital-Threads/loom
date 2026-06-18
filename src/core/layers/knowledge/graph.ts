// L7.3 — derive a problem→solution graph from recall hits (derive-only, no
// separate store). Decisions become "solution" nodes, rejections "rejected"
// nodes; hits sharing a task link together.
import type { RecallHit } from "./index.js";

export type NodeKind = "decision" | "rejection" | "other";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  taskId: string;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function kindOf(eventType: string): NodeKind {
  if (eventType === "decision") return "decision";
  if (eventType === "rejection") return "rejection";
  return "other";
}

/** Build a graph: one node per hit; edges link hits of the same task in order
 *  (a small reasoning chain). */
export function buildGraph(hits: RecallHit[]): KnowledgeGraph {
  const nodes: GraphNode[] = hits.map((h, i) => ({
    id: `n${i}`,
    kind: kindOf(h.eventType),
    taskId: h.taskId,
    label: h.text.length > 80 ? `${h.text.slice(0, 77)}…` : h.text,
  }));
  const edges: GraphEdge[] = [];
  const lastByTask = new Map<string, string>();
  nodes.forEach((n) => {
    const prev = lastByTask.get(n.taskId);
    if (prev) edges.push({ from: prev, to: n.id });
    lastByTask.set(n.taskId, n.id);
  });
  return { nodes, edges };
}
