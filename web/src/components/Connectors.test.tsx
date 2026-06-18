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
    listConnectors: () => Promise.resolve([
      { id: "beads", label: "beads", needsRepo: false },
      { id: "github", label: "GitHub Issues", needsRepo: true },
    ]),
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

  it("shows the import result after Import", async () => {
    const user = userEvent.setup();
    render(<Connectors client={mkClient()} />);
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Imported 3")).toBeInTheDocument();
  });

  it("reports nothing-new when import created zero", async () => {
    const user = userEvent.setup();
    render(<Connectors client={mkClient({ importTracker: () => Promise.resolve({ created: 0 }) })} />);
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Nothing new to import")).toBeInTheDocument();
  });
});

describe("Connectors — connector selector", () => {
  it("shows the owner/repo field when GitHub Issues is selected", async () => {
    const user = userEvent.setup();
    render(<Connectors client={mkClient()} />);
    await screen.findByText("mcp-server-fs");
    expect(screen.queryByPlaceholderText("owner/repo")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Connector"), "github");
    expect(screen.getByPlaceholderText("owner/repo")).toBeInTheDocument();
  });

  it("sends the selected connector and repo to importTracker", async () => {
    const user = userEvent.setup();
    const calls: unknown[] = [];
    const client = mkClient({ importTracker: (o: unknown) => { calls.push(o); return Promise.resolve({ created: 1 }); } });
    render(<Connectors client={client} />);
    await screen.findByText("mcp-server-fs");
    await user.selectOptions(screen.getByLabelText("Connector"), "github");
    await user.type(screen.getByPlaceholderText("owner/repo"), "octocat/hello");
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(calls).toEqual([{ connector: "github", repo: "octocat/hello" }]);
  });
});

describe("Connectors add form — args/env + remote", () => {
  it("sends parsed args array and env object for a stdio server", async () => {
    const user = userEvent.setup();
    const calls: unknown[] = [];
    const client = mkClient({ mcpAdd: (s: unknown) => { calls.push(s); return Promise.resolve({}); } });
    render(<Connectors client={client} />);
    await screen.findByText("mcp-server-fs");
    await user.type(screen.getByPlaceholderText("id"), "git");
    await user.type(screen.getByPlaceholderText("command (e.g. mcp-server-fs)"), "mcp-git");
    // One arg per line, so an arg may contain spaces.
    await user.type(screen.getByPlaceholderText("args (one per line)"), "--root{enter}/my repo");
    // One KEY=VALUE per line, so a value may contain a comma.
    await user.type(screen.getByPlaceholderText("env (KEY=VALUE, one per line)"), "TOKEN=a,b{enter}LEVEL=debug");
    await user.click(screen.getByRole("button", { name: "Add MCP" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: "git",
      transport: "stdio",
      command: "mcp-git",
      args: ["--root", "/my repo"],
      env: { TOKEN: "a,b", LEVEL: "debug" },
    });
  });

  it("shows the url field for a remote server and sends transport + url", async () => {
    const user = userEvent.setup();
    const calls: unknown[] = [];
    const client = mkClient({ mcpAdd: (s: unknown) => { calls.push(s); return Promise.resolve({}); } });
    render(<Connectors client={client} />);
    await screen.findByText("mcp-server-fs");
    await user.selectOptions(screen.getByLabelText("Transport"), "http");
    expect(screen.queryByPlaceholderText("command (e.g. mcp-server-fs)")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("id"), "api");
    await user.type(screen.getByPlaceholderText("url (e.g. https://host/mcp)"), "https://host/mcp");
    await user.click(screen.getByRole("button", { name: "Add MCP" }));
    expect(calls).toEqual([{ id: "api", transport: "http", url: "https://host/mcp" }]);
  });
});
