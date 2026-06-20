import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript } from "./Transcript";
import type { LoomClient } from "../api";

function mkClient(turns: { stage: string; input: string; output: string }[]) {
  return {
    transcript: vi.fn(() => Promise.resolve(turns)),
  } as unknown as LoomClient;
}

const noop = () => {};
// jsdom doesn't implement scrollIntoView (Transcript auto-scrolls to the bottom).
Element.prototype.scrollIntoView = vi.fn();

describe("Transcript — review turns don't dump raw JSON findings", () => {
  it("keeps the prose summary and strips the trailing findings JSON array", async () => {
    const output =
      'Код идентичен ранее отревьюенному — правок нет.\n' +
      '[{ "severity": "bug", "message": "STILL PRESENT: path divergence", "file": "src/x.ts" }]';
    render(<Transcript client={mkClient([{ stage: "review", input: "p", output }])} taskId="t" live={[]} runId={null} reloadKey={0} onOpenFile={noop} />);
    expect(await screen.findByText(/Код идентичен ранее отревьюенному/)).toBeInTheDocument(); // prose kept
    expect(screen.queryByText(/STILL PRESENT/)).toBeNull(); // raw JSON not dumped
    expect(screen.getByText(/findings card above/i)).toBeInTheDocument(); // pointer to the structured card
  });

  it("leaves a non-review turn's output untouched", async () => {
    render(<Transcript client={mkClient([{ stage: "impl", input: "p", output: "ИТОГ: ГОТОВО — done" }])} taskId="t" live={[]} runId={null} reloadKey={0} onOpenFile={noop} />);
    expect(await screen.findByText(/ИТОГ: ГОТОВО — done/)).toBeInTheDocument();
  });
});
