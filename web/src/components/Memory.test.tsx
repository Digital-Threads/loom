import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Memory } from "./Memory";
import type { LoomClient, ProjectEntry } from "../api";

const TASKS = [
  { id: "t1", title: "Refund flow", status: "running", project_id: "p1" },
  { id: "t2", title: "Login fix", status: "done", project_id: "p2" },
];

const PROJECTS: ProjectEntry[] = [
  { projectId: "p1", root: "/a", name: "Web", addedAt: 0 },
  { projectId: "p2", root: "/b", name: "API", addedAt: 0 },
];

function mkClient(over: Partial<Record<string, unknown>> = {}) {
  return {
    tasks: () => Promise.resolve(TASKS),
    boardJournal: (id: string) =>
      Promise.resolve(id === "t1" ? "## Summary\nDid the thing." : ""),
    ...over,
  } as unknown as LoomClient;
}

describe("Memory list", () => {
  it("shows a temperature status chip per task in the left list", async () => {
    render(<Memory client={mkClient()} projects={PROJECTS} />);
    await screen.findByText("Refund flow");
    // statusClass("running") → "run", statusClass("done") → "done"
    const running = screen.getAllByText("running")[0].closest(".chip");
    expect(running).toHaveClass("run");
    const done = screen.getAllByText("done")[0].closest(".chip");
    expect(done).toHaveClass("done");
  });
});

describe("Memory detail header", () => {
  it("renders a clear title + status chip above the reasoning when a task is picked", async () => {
    const user = userEvent.setup();
    render(<Memory client={mkClient()} projects={PROJECTS} />);
    await user.click(await screen.findByText("Refund flow"));
    // a real <h2> header, not just text inside the markdown
    expect(screen.getByRole("heading", { name: "Refund flow" }).tagName).toBe("H2");
    // the reasoning section heading is rendered too
    await screen.findByText("Summary");
  });

  it("shows the project chip only when more than one project exists", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Memory client={mkClient()} projects={PROJECTS} />);
    await user.click(await screen.findByText("Refund flow"));
    expect(screen.getByText("Web")).toBeInTheDocument();
    unmount();

    // single project → no project chip
    render(<Memory client={mkClient()} projects={[PROJECTS[0]]} />);
    await user.click(await screen.findByText("Refund flow"));
    expect(screen.queryByText("Web")).toBeNull();
  });
});

describe("Memory states preserved", () => {
  it("shows an error state when the task list fails to load", async () => {
    render(<Memory client={mkClient({ tasks: () => Promise.reject(new Error("boom")) })} />);
    await screen.findByText(/boom/);
  });

  it("shows an empty state when there are no tasks", async () => {
    render(<Memory client={mkClient({ tasks: () => Promise.resolve([]) })} />);
    await screen.findByText(/No tasks yet/i);
  });

  it("shows an empty reasoning state when the picked task has no journal", async () => {
    const user = userEvent.setup();
    render(<Memory client={mkClient()} projects={PROJECTS} />);
    await user.click(await screen.findByText("Login fix"));
    // header still renders, but the pack is empty
    expect(screen.getByRole("heading", { name: "Login fix" }).tagName).toBe("H2");
    await screen.findByText(/No reasoning recorded/i);
  });
});
