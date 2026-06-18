import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Connectors } from "./Connectors";
import type { LoomClient, McpServer } from "../api";

function mkClient(over: Partial<Record<keyof LoomClient, unknown>> = {}) {
  const servers: McpServer[] = [{ id: "fs", command: "mcp-server-fs", enabled: true }];
  return {
    mcpList: () => Promise.resolve(servers),
    mcpTest: () => Promise.resolve({ ok: true }),
    importTracker: () => Promise.resolve({ created: 3 }),
    ...over,
  } as unknown as LoomClient;
}

describe("Connectors status feedback", () => {
  it("shows a Reachable chip after a successful Test", async () => {
    const user = userEvent.setup();
    render(<Connectors client={mkClient()} />);
    await screen.findByText("mcp-server-fs");
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Reachable")).toBeInTheDocument();
  });

  it("shows an Unreachable chip when Test fails", async () => {
    const user = userEvent.setup();
    render(<Connectors client={mkClient({ mcpTest: () => Promise.resolve({ ok: false, error: "boom" }) })} />);
    await screen.findByText("mcp-server-fs");
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
  });

  it("shows the import result after Import from beads", async () => {
    const user = userEvent.setup();
    render(<Connectors client={mkClient()} />);
    await user.click(screen.getByRole("button", { name: "Import from beads" }));
    expect(await screen.findByText("Imported 3")).toBeInTheDocument();
  });

  it("reports nothing-new when import created zero", async () => {
    const user = userEvent.setup();
    render(<Connectors client={mkClient({ importTracker: () => Promise.resolve({ created: 0 }) })} />);
    await user.click(screen.getByRole("button", { name: "Import from beads" }));
    expect(await screen.findByText("Nothing new to import")).toBeInTheDocument();
  });
});
