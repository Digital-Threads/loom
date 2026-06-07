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

describe("view-схема (Task 7.2): типы ViewSpec типизируются и поля доступны", () => {
  it("SummaryView литерал типизируется", () => {
    const x: ViewSpec = {
      kind: "summary",
      lines: [
        { label: "Подписки", value: "subscriptions.length" },
        { label: "Сессии", value: { fn: "count", args: ["sessions"] }, color: "green", when: "ready" },
      ],
    } satisfies SummaryView;

    expect(x.kind).toBe("summary");
    const s = x as SummaryView;
    expect(s.lines.length).toBe(2);
    expect(s.lines[0].label).toBe("Подписки");
    expect(s.lines[1].color).toBe("green");
  });

  it("TableView литерал с onSelect + actions + marker типизируется", () => {
    const x: ViewSpec = {
      kind: "table",
      source: "tasks",
      rowKey: "id",
      columns: [
        { value: "status", marker: { when: "done", truthy: "✓", falsy: "○" } },
        { header: "Заголовок", value: "title", width: 40, align: "left" },
        { header: "ID", value: "id", align: "right" },
      ],
      empty: "нет задач",
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

  it("DetailView литерал с sections + scalars + actions (items как {fn}) типизируется", () => {
    const x: ViewSpec = {
      kind: "detail",
      idParam: "taskId",
      title: { fn: "taskTitle", args: ["taskId"] },
      sections: [
        { label: "Решения", items: { fn: "taskDetailFromEvents", args: ["taskId"] }, itemText: "text", empty: "—" },
        { label: "Находки", items: "findings", itemText: "text" },
      ],
      scalars: [{ label: "Токены задачи", value: { fn: "tokensForTask", args: ["taskId"] } }],
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
    expect(d.scalars?.[0].label).toBe("Токены задачи");
    expect(d.actions?.[0].key).toBe("c");
    expect(d.actions?.[1].key).toBe("t");
  });

  it("FormView литерал типизируется", () => {
    const x: ViewSpec = { kind: "form", source: "registry-settings" } satisfies FormView;
    expect(x.kind).toBe("form");
    const f = x as FormView;
    expect(f.source).toBe("registry-settings");
  });

  it("Bind escape-hatch {fn,args} типизируется", () => {
    const b: Bind = { fn: "tokensForTask", args: ["taskId"] };
    expect(typeof b).toBe("object");
    const fnBind = b as { fn: string; args?: unknown[] };
    expect(fnBind.fn).toBe("tokensForTask");
    expect(fnBind.args?.[0]).toBe("taskId");

    const plain: Bind = "subscriptions.length";
    expect(plain).toBe("subscriptions.length");
  });

  it("LoomPlugin с views: {tasks: tableSpec} типизируется", () => {
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

  it("LoomPlugin с views как массивом ViewSpec[] (составная вкладка) типизируется", () => {
    const views: ViewSpec[] = [
      { kind: "summary", lines: [{ label: "Итого", value: { fn: "tokenTotals" } }] },
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

  it("SettingField с readonly:true типизируется", () => {
    const field: SettingField = {
      key: "config.path",
      label: "Config path",
      type: "string",
      readonly: true,
    };
    expect(field.readonly).toBe(true);
  });
});
