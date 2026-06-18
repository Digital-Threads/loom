import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board";
import type { LoomClient } from "../api";

function mkClient(moveTask = vi.fn(() => Promise.resolve({ current: "impl" }))) {
  const cols = [
    { stageKey: "analysis", cards: [{ id: "t1", title: "Refund", status: "idle", projectId: "p" }] },
    { stageKey: "impl", cards: [] },
  ];
  return { board: () => Promise.resolve(cols), moveTask } as unknown as LoomClient;
}

describe("Board keyboard accessibility", () => {
  it("renders each card as a focusable button", async () => {
    render(<Board client={mkClient()} onOpen={() => {}} />);
    const card = await screen.findByRole("button", { name: /Open task: Refund/ });
    expect(card).toHaveAttribute("tabindex", "0");
  });

  it("opens a task with Enter", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<Board client={mkClient()} onOpen={onOpen} />);
    const card = await screen.findByRole("button", { name: /Open task: Refund/ });
    card.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("t1");
  });

  it("moves a card to a stage via the keyboard 'Move to stage' select", async () => {
    const moveTask = vi.fn(() => Promise.resolve({ current: "impl" }));
    const user = userEvent.setup();
    render(<Board client={mkClient(moveTask)} onOpen={() => {}} />);
    await screen.findByText("Refund");
    await user.selectOptions(screen.getByLabelText("Move to stage"), "impl");
    expect(moveTask).toHaveBeenCalledWith("t1", "impl", true);
  });
});

function emptyClient() {
  const cols = [
    { stageKey: "analysis", cards: [] },
    { stageKey: "impl", cards: [] },
  ];
  return { board: () => Promise.resolve(cols) } as unknown as LoomClient;
}

describe("Board empty states", () => {
  it("shows a whole-board empty state with a working CTA when there are no tasks", async () => {
    const onNew = vi.fn();
    const user = userEvent.setup();
    render(<Board client={emptyClient()} onOpen={() => {}} onNew={onNew} />);
    await screen.findByText(/No tasks yet/i);
    expect(screen.queryByText("—")).toBeNull();
    await user.click(screen.getByRole("button", { name: /New task/i }));
    expect(onNew).toHaveBeenCalled();
  });

  it("shows the empty state (not a row of columns) when the filter matches nothing", async () => {
    render(<Board client={mkClient()} onOpen={() => {}} projectFilter="other" />);
    await screen.findByText(/No tasks in this project/i);
    expect(screen.queryByText("Drop a task here")).toBeNull();
  });

  it("shows a dropzone hint in an empty column while the board has tasks", async () => {
    render(<Board client={mkClient()} onOpen={() => {}} />);
    await screen.findByText("Refund");
    expect(screen.getByText("Drop a task here")).toBeTruthy();
  });
});
