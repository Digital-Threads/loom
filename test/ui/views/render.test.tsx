import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { TableView } from "../../../src/ui/views/TableView.js";
import { SummaryView } from "../../../src/ui/views/SummaryView.js";
import type { TableView as TableViewSpec, SummaryView as SummaryViewSpec } from "../../../src/core/plugins/types.js";
import type { BindContext } from "../../../src/core/views/resolve.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function makeData(over: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
    ...over,
  } as WorkspaceData;
}

describe("TableView render smoke", () => {
  it("renders row cells from data", () => {
    const spec: TableViewSpec = {
      kind: "table",
      source: "subscriptions",
      rowKey: "name",
      columns: [
        { header: "Имя", value: "name", width: 14 },
        { header: "CLI", value: "cli" },
      ],
    };
    const ctx: BindContext = {
      data: makeData({ subscriptions: [{ name: "claude", cli: "claude-cli", isSource: true }] }),
    };
    const { lastFrame } = render(<TableView spec={spec} ctx={ctx} />);
    expect(lastFrame()).toContain("claude");
    expect(lastFrame()).toContain("claude-cli");
  });

  it("renders empty placeholder", () => {
    const spec: TableViewSpec = {
      kind: "table",
      source: "subscriptions",
      rowKey: "name",
      columns: [{ value: "name" }],
      empty: "Нет подписок",
    };
    const { lastFrame } = render(<TableView spec={spec} ctx={{ data: makeData() }} />);
    expect(lastFrame()).toContain("Нет подписок");
  });
});

describe("SummaryView render smoke", () => {
  it("renders labels and resolved values", () => {
    const spec: SummaryViewSpec = {
      kind: "summary",
      lines: [{ label: "Подписки", value: "subscriptions.length" }],
    };
    const ctx: BindContext = {
      data: makeData({ subscriptions: [{ name: "a", cli: "c", isSource: false }] }),
    };
    const { lastFrame } = render(<SummaryView spec={spec} ctx={ctx} />);
    expect(lastFrame()).toContain("Подписки: 1");
  });
});
