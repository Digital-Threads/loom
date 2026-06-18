import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Knowledge } from "./Knowledge";
import type { LoomClient, KnowledgeGraph } from "../api";

function mkClient(over: Partial<LoomClient> = {}) {
  return {
    recall: vi.fn(() => Promise.resolve({ hits: [], decisions: [], rejections: [] })),
    knowledgeGraph: vi.fn(() => Promise.resolve({ nodes: [], edges: [] } as KnowledgeGraph)),
    search: vi.fn(() => Promise.resolve({ hits: [] })),
    ...over,
  } as unknown as LoomClient;
}

describe("Knowledge", () => {
  it("shows an initial empty-state hint before any search", () => {
    render(<Knowledge client={mkClient()} />);
    expect(screen.getByText(/Search prior reasoning across this project/)).toBeInTheDocument();
  });

  it("renders decisions, rejections, graph and similar after a recall", async () => {
    const user = userEvent.setup();
    // The graph is built client-side from the recall hits — no separate call.
    const client = mkClient({
      recall: vi.fn(() => Promise.resolve({
        hits: [
          { taskId: "t1", eventType: "decision", text: "use axum", score: 1 },
          { taskId: "t1", eventType: "rejection", text: "drop warp", score: 1 },
        ],
        decisions: [{ taskId: "t1", eventType: "decision", text: "use axum", score: 1 }],
        rejections: [{ taskId: "t1", eventType: "rejection", text: "drop warp", score: 1 }],
      })),
      search: vi.fn(() => Promise.resolve({ hits: [{ taskId: "t2", eventType: "finding", text: "axum tuned", score: 0.5 }] })),
    });
    render(<Knowledge client={client} />);
    await user.type(screen.getByPlaceholderText(/switch to axum/), "axum");
    await user.click(screen.getByRole("button", { name: "Recall" }));

    expect(await screen.findByText(/Already decided/)).toBeInTheDocument();
    expect(screen.getByText(/Already rejected/)).toBeInTheDocument();
    expect(screen.getByText(/Reasoning graph/)).toBeInTheDocument();
    expect(screen.getByText(/Similar prior reasoning/)).toBeInTheDocument();
    // graph node carries the kind class so the design-system colours apply
    const node = screen.getByTitle("use axum");
    expect(node).toHaveClass("kg-node", "decision");
  });

  it("shows a 'nothing found' empty-state when a search returns nothing", async () => {
    const user = userEvent.setup();
    render(<Knowledge client={mkClient()} />);
    await user.type(screen.getByPlaceholderText(/switch to axum/), "nope");
    await user.click(screen.getByRole("button", { name: "Recall" }));
    expect(await screen.findByText(/Nothing prior found for/)).toBeInTheDocument();
  });
});
