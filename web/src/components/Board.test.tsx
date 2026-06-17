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
