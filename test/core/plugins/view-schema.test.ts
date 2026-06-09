import { describe, it, expect } from "vitest";
import type {
  Bind,
  SummaryView,
  TableView,
  DetailView,
  FormView,
  ViewSpec,
  LoomPlugin,
  SettingField,
} from "../../../src/core/plugins/types.js";

describe("view schema (Task 7.2): ViewSpec types type-check and fields are accessible", () => {
  it("SummaryView literal type-checks", () => {
    const x: ViewSpec = {
      kind: "summary",
      lines: [
        { label: "Subscriptions", value: "subscriptions.length" },
        { label: "Sessions", value: { fn: "count", args: ["sessions"] }, color: "green", when: "ready" },
      ],
    } satisfies SummaryView;

    expect(x.kind).toBe("summary");
    const s = x as SummaryView;
    expect(s.lines.length).toBe(2);
    expect(s.lines[0].label).toBe("Subscriptions");
    expect(s.lines[1].color).toBe("green");
  });

  it("TableView literal with onSelect + actions + marker type-checks", () => {
    const x: ViewSpec = {
      kind: "table",
      source: "tasks",
      rowKey: "id",
      columns: [
        { value: "status", marker: { when: "done", truthy: "✓", falsy: "○" } },
        { header: "Title", value: "title", width: 40, align: "left" },
        { header: "ID", value: "id", align: "right" },
      ],
      empty: "no tasks",
      selectable: true,
      onSelect: { openView: "taskDetail", passId: "id" },
      actions: [{ key: "c", actionId: "closeTask", args: { taskId: "id" }, label: "close" }],
    } satisfies TableView;

    expect(x.kind).toBe("table");
    const t = x as TableView;
    expect(t.columns.length).toBe(3);
    expect(t.columns[0].marker?.truthy).toBe("✓");
    expect(t.columns[0].marker?.falsy).toBe("○");
    expect(t.selectable).toBe(true);
    expect(t.onSelect?.openView).toBe("taskDetail");
    expect(t.onSelect?.passId).toBe("id");
    expect(t.actions?.[0].key).toBe("c");
    expect(t.actions?.[0].actionId).toBe("closeTask");
  });

  it("DetailView literal with sections + scalars + actions (items as {fn}) type-checks", () => {
    const x: ViewSpec = {
      kind: "detail",
      idParam: "taskId",
      title: { fn: "taskTitle", args: ["taskId"] },
      sections: [
        { label: "Decisions", items: { fn: "taskDetailFromEvents", args: ["taskId"] }, itemText: "text", empty: "—" },
        { label: "Findings", items: "findings", itemText: "text" },
      ],
      scalars: [{ label: "Task tokens", value: { fn: "tokensForTask", args: ["taskId"] } }],
      actions: [
        { key: "c", actionId: "closeTask", args: { taskId: "taskId" } },
        { key: "t", actionId: "writeTokenMetric", args: { taskId: "taskId", tokens: { fn: "tokensForTask", args: ["taskId"] } } },
      ],
    } satisfies DetailView;

    expect(x.kind).toBe("detail");
    const d = x as DetailView;
    expect(d.idParam).toBe("taskId");
    expect(d.sections.length).toBe(2);
    expect(d.sections[0].itemText).toBe("text");
    expect(d.scalars?.[0].label).toBe("Task tokens");
    expect(d.actions?.[0].key).toBe("c");
    expect(d.actions?.[1].key).toBe("t");
  });

  it("FormView literal type-checks", () => {
    const x: ViewSpec = { kind: "form", source: "registry-settings" } satisfies FormView;
    expect(x.kind).toBe("form");
    const f = x as FormView;
    expect(f.source).toBe("registry-settings");
  });

  it("Bind escape-hatch {fn,args} type-checks", () => {
    const b: Bind = { fn: "tokensForTask", args: ["taskId"] };
    expect(typeof b).toBe("object");
    const fnBind = b as { fn: string; args?: unknown[] };
    expect(fnBind.fn).toBe("tokensForTask");
    expect(fnBind.args?.[0]).toBe("taskId");

    const plain: Bind = "subscriptions.length";
    expect(plain).toBe("subscriptions.length");
  });

  it("LoomPlugin with views: {tasks: tableSpec} type-checks", () => {
    const tableSpec: TableView = {
      kind: "table",
      source: "tasks",
      rowKey: "id",
      columns: [{ value: "title" }],
    };

    const plugin: LoomPlugin = {
      id: "task-journal",
      title: "Tasks",
      tabs: [{ id: "tasks", title: "Tasks" }],
      load: () => ({}),
      views: { tasks: tableSpec },
    };

    expect(plugin.views?.tasks).toBe(tableSpec);
    expect((plugin.views?.tasks as TableView).kind).toBe("table");
  });

  it("LoomPlugin with views as a ViewSpec[] array (composite tab) type-checks", () => {
    const views: ViewSpec[] = [
      { kind: "summary", lines: [{ label: "Total", value: { fn: "tokenTotals" } }] },
      { kind: "table", source: "tokens", rowKey: "sessionId", columns: [{ value: "used" }] },
    ];

    const plugin: LoomPlugin = {
      id: "token-pilot",
      title: "Tokens",
      tabs: [{ id: "tokens", title: "Tokens" }],
      load: () => ({}),
      views: { tokens: views },
    };

    expect(Array.isArray(plugin.views?.tokens)).toBe(true);
    expect((plugin.views?.tokens as ViewSpec[]).length).toBe(2);
  });

  it("SettingField with readonly:true type-checks", () => {
    const field: SettingField = {
      key: "config.path",
      label: "Config path",
      type: "string",
      readonly: true,
    };
    expect(field.readonly).toBe(true);
  });
});
