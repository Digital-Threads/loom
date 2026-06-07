import React, { useReducer } from "react";
import { Box, useInput } from "ink";
import type {
  ActionBinding,
  LoomPlugin,
  TableView as TableViewSpec,
  DetailView as DetailViewSpec,
  ViewSpec,
} from "../../core/plugins/types.js";
import type { WorkspaceData } from "../../core/data/loader.js";
import { resolveBind, getDotted, type BindContext } from "../../core/views/resolve.js";
import {
  viewReducer,
  initialViewState,
  type ViewEvent,
  type ViewState,
  type ViewReducerOpts,
} from "../../core/views/view-reducer.js";
import { SummaryView } from "./SummaryView.js";
import { TableView } from "./TableView.js";
import { DetailView } from "./DetailView.js";
import { FormView } from "./FormView.js";

interface ViewRendererProps {
  plugin?: LoomPlugin;                  // host-виды (Обзор/Настройки) не имеют плагина
  spec: ViewSpec | ViewSpec[];
  data: WorkspaceData;
}

// Нормализуем в массив видов (составная вкладка — несколько ViewSpec сверху вниз).
function asArray(spec: ViewSpec | ViewSpec[]): ViewSpec[] {
  return Array.isArray(spec) ? spec : [spec];
}

// Интерактивный (selectable/detail/onSelect) вид в массиве — управляет навигацией.
// В v1 их максимум один на вкладку (table-список ИЛИ form), остальное — статичный вывод.
function findInteractive(specs: ViewSpec[]): ViewSpec | undefined {
  return specs.find(
    (s) =>
      (s.kind === "table" && (s.selectable || (s.actions?.length ?? 0) > 0)) ||
      s.kind === "detail",
  );
}

// Резолвит detail-spec открытого подвида из plugin.views[viewKey] (напр. "taskDetail"),
// падая обратно на detail-вид среди specs текущей вкладки (на случай составной вкладки).
function resolveDetailSpec(
  viewKey: string,
  specs: ViewSpec[],
  plugin: LoomPlugin | undefined,
): DetailViewSpec | undefined {
  const fromViews = plugin?.views?.[viewKey];
  if (fromViews && !Array.isArray(fromViews) && fromViews.kind === "detail") {
    return fromViews;
  }
  return specs.find((s) => s.kind === "detail") as DetailViewSpec | undefined;
}

function buildOpts(
  specs: ViewSpec[],
  state: ViewState,
  plugin: LoomPlugin | undefined,
  data: WorkspaceData,
): { opts: ViewReducerOpts; current: ViewSpec | undefined } {
  const frame = state.stack[state.stack.length - 1];
  // Если в стеке detail-кадр, берём его detail-вид; иначе интерактивный вид вкладки.
  const detailSpec =
    state.stack.length > 1 ? resolveDetailSpec(frame.viewKey, specs, plugin) : undefined;
  const current = detailSpec ?? findInteractive(specs);

  if (!current) return { opts: { listLength: 0 }, current };

  if (current.kind === "table") {
    const ctx: BindContext = { data, idParam: frame.idParam };
    const rows = (resolveBind(current.source, ctx) as Record<string, unknown>[]) ?? [];
    const selectedRow = rows[state.cursor];
    const selectedId = current.onSelect
      ? String(getDotted(selectedRow ?? {}, current.onSelect.passId) ?? "")
      : undefined;
    return {
      current,
      opts: {
        listLength: rows.length,
        hasOnSelect: Boolean(current.onSelect),
        openView: current.onSelect?.openView,
        selectedId,
        confirmKeys: confirmKeysFor(current.actions, plugin),
      },
    };
  }

  if (current.kind === "detail") {
    return {
      current,
      opts: {
        listLength: 0,
        confirmKeys: confirmKeysFor(current.actions, plugin),
      },
    };
  }

  return { opts: { listLength: 0 }, current };
}

function confirmKeysFor(
  actions: ActionBinding[] | undefined,
  plugin: LoomPlugin | undefined,
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const a of actions ?? []) {
    const action = plugin?.actions?.find((x) => x.id === a.actionId);
    map[a.key] = Boolean(action?.confirm);
  }
  return map;
}

// Резолвит и исполняет ActionBinding. result.ok → статус-строка.
function runAction(binding: ActionBinding, ctx: BindContext, plugin: LoomPlugin | undefined): string {
  const action = plugin?.actions?.find((x) => x.id === binding.actionId);
  if (!action) return `действие не найдено: ${binding.actionId}`;
  const args: Record<string, unknown> = {};
  for (const [k, bind] of Object.entries(binding.args ?? {})) {
    args[k] = resolveBind(bind, ctx);
  }
  const res = action.run({ projectRoot: process.cwd() }, args);
  return res.ok ? "готово (обновится при перезапуске)" : `ошибка: ${res.error ?? ""}`;
}

export function ViewRenderer({ plugin, spec, data }: ViewRendererProps) {
  const specs = asArray(spec);
  const rootKey = "root";
  const [state, dispatch] = useReducer(
    (s: ViewState, e: ViewEvent) => {
      const { opts } = buildOpts(specs, s, plugin, data);
      return viewReducer(s, e, opts);
    },
    initialViewState(rootKey),
  );

  const { current } = buildOpts(specs, state, plugin, data);
  const frame = state.stack[state.stack.length - 1];
  const inDetail = state.stack.length > 1;

  useInput((input, key) => {
    // confirm-режим: y исполняет action, n/esc отменяет.
    if (state.mode === "confirm" && state.confirmKey) {
      if (input === "y") {
        const binding = (current as TableViewSpec | DetailViewSpec)?.actions?.find(
          (a) => a.key === state.confirmKey,
        );
        let status = "отмена";
        if (binding) {
          const ctx: BindContext = { data, idParam: frame.idParam };
          status = runAction(binding, ctx, plugin);
        }
        dispatch({ type: "setStatus", text: status });
      } else if (input === "n" || key.escape) {
        dispatch({ type: "confirmNo" });
      }
      return;
    }

    if (key.upArrow) dispatch({ type: "up" });
    else if (key.downArrow) dispatch({ type: "down" });
    else if (key.return) dispatch({ type: "enter" });
    else if (key.escape) dispatch({ type: "esc" });
    else if (input) {
      // action-key из текущего интерактивного вида?
      const binding = (current as TableViewSpec | DetailViewSpec)?.actions?.find(
        (a) => a.key === input,
      );
      if (binding) {
        const action = plugin?.actions?.find((x) => x.id === binding.actionId);
        if (action?.confirm) {
          dispatch({ type: "actionKey", key: input });
        } else {
          const ctx: BindContext = { data, idParam: frame.idParam };
          dispatch({ type: "setStatus", text: runAction(binding, ctx, plugin) });
        }
      }
    }
  });

  // detail-режим: показываем detail-вид с idParam из стека.
  if (inDetail) {
    const detailSpec = resolveDetailSpec(frame.viewKey, specs, plugin);
    if (detailSpec) {
      const ctx: BindContext = { data, idParam: frame.idParam };
      return (
        <DetailView
          spec={detailSpec}
          ctx={ctx}
          confirmKey={state.mode === "confirm" ? state.confirmKey : null}
          status={state.status}
        />
      );
    }
  }

  // Список видов сверху вниз. Интерактивной таблице отдаём cursor.
  const ctx: BindContext = { data, idParam: frame.idParam };
  return (
    <Box flexDirection="column">
      {specs.map((s, i) => {
        if (s.kind === "detail") return null; // detail рисуется по стеку, не в списке
        if (s.kind === "summary") return <SummaryView key={i} spec={s} ctx={ctx} />;
        if (s.kind === "table") {
          return (
            <TableView
              key={i}
              spec={s}
              ctx={ctx}
              cursor={current === s ? state.cursor : -1}
            />
          );
        }
        if (s.kind === "form") return <FormView key={i} />;
        return null;
      })}
    </Box>
  );
}
