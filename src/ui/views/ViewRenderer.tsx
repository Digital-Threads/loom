import React, { useReducer, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type {
  ActionBinding,
  LoomPlugin,
  TableView as TableViewSpec,
  DetailView as DetailViewSpec,
  ViewSpec,
} from "../../core/plugins/types.js";
import type { WorkspaceData } from "../../core/data/loader.js";
import { resolveBind, getDotted, type BindContext } from "../../core/views/resolve.js";
import { allDerivations } from "../../core/views/all-derivations.js";
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
import { TextInput } from "../input/TextInput.js";
import { requestHandover } from "../../core/handover.js";

interface ViewRendererProps {
  plugin?: LoomPlugin;                  // host views (Overview/Settings) have no plugin
  spec: ViewSpec | ViewSpec[];
  data: WorkspaceData;
}

// Normalize into an array of views (a composite tab -- several ViewSpec top to bottom).
function asArray(spec: ViewSpec | ViewSpec[]): ViewSpec[] {
  return Array.isArray(spec) ? spec : [spec];
}

// An interactive (selectable/detail/onSelect) view in the array -- it drives navigation.
// In v1 there is at most one per tab (a table list OR a form), the rest is static output.
function findInteractive(specs: ViewSpec[]): ViewSpec | undefined {
  return specs.find(
    (s) =>
      (s.kind === "table" && (s.selectable || (s.actions?.length ?? 0) > 0)) ||
      s.kind === "detail",
  );
}

// Resolves the detail spec of the open subview from plugin.views[viewKey] (e.g. "taskDetail"),
// falling back to a detail view among the current tab's specs (in case of a composite tab).
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
  // If there is a detail frame on the stack, take its detail view; otherwise the tab's interactive view.
  const detailSpec =
    state.stack.length > 1 ? resolveDetailSpec(frame.viewKey, specs, plugin) : undefined;
  const current = detailSpec ?? findInteractive(specs);

  if (!current) return { opts: { listLength: 0 }, current };

  if (current.kind === "table") {
    const ctx: BindContext = { data, idParam: frame.idParam, derivations: allDerivations() };
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

// Resolves and runs an ActionBinding. result.ok -> status line + optional handover thunk.
function runAction(
  binding: ActionBinding,
  ctx: BindContext,
  plugin: LoomPlugin | undefined,
  extra: Record<string, unknown> = {},
): { status: string; handover?: () => unknown | Promise<unknown> } {
  const action = plugin?.actions?.find((x) => x.id === binding.actionId);
  if (!action) return { status: `action not found: ${binding.actionId}` };
  const args: Record<string, unknown> = {};
  for (const [k, bind] of Object.entries(binding.args ?? {})) {
    args[k] = resolveBind(bind, ctx);
  }
  Object.assign(args, extra); // typed prompt values augment/override the static ones
  const res = action.run({ projectRoot: process.cwd() }, args);
  return {
    status: res.ok ? "done (updates on restart)" : `error: ${res.error ?? ""}`,
    handover: res.handover,
  };
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
  const { exit } = useApp();

  const applyAction = (r: { status: string; handover?: () => unknown | Promise<unknown> }) => {
    dispatch({ type: "setStatus", text: r.status });
    if (r.handover) {
      requestHandover(r.handover);
      exit(); // tear down Ink -> cli.tsx runs the handover after waitUntilExit
    }
  };

  const [prompt, setPrompt] = useState<{
    binding: ActionBinding;
    fields: { key: string; label: string }[];
    idx: number;
    values: Record<string, string>;
  } | null>(null);

  useInput((input, key) => {
    if (prompt) return; // TextInput owns input while we collect prompt fields
    // confirm mode: y runs the action, n/esc cancels.
    if (state.mode === "confirm" && state.confirmKey) {
      if (input === "y") {
        const binding = (current as TableViewSpec | DetailViewSpec)?.actions?.find(
          (a) => a.key === state.confirmKey,
        );
        if (binding) {
          const ctx: BindContext = { data, idParam: frame.idParam, derivations: allDerivations() };
          applyAction(runAction(binding, ctx, plugin));
        } else {
          dispatch({ type: "setStatus", text: "cancelled" });
        }
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
      // an action-key from the current interactive view?
      const binding = (current as TableViewSpec | DetailViewSpec)?.actions?.find(
        (a) => a.key === input,
      );
      if (binding) {
        const action = plugin?.actions?.find((x) => x.id === binding.actionId);
        if (action?.prompt && action.prompt.length > 0) {
          setPrompt({ binding, fields: action.prompt, idx: 0, values: {} });
        } else if (action?.confirm) {
          dispatch({ type: "actionKey", key: input });
        } else {
          const ctx: BindContext = { data, idParam: frame.idParam, derivations: allDerivations() };
          applyAction(runAction(binding, ctx, plugin));
        }
      }
    }
  });

  if (prompt) {
    const field = prompt.fields[prompt.idx];
    return (
      <Box flexDirection="column">
        <Box>
          <Text>{field.label}: </Text>
          <TextInput
            key={prompt.idx}
            placeholder={field.label}
            onSubmit={(val) => {
              const values = { ...prompt.values, [field.key]: val };
              if (prompt.idx + 1 < prompt.fields.length) {
                setPrompt({ ...prompt, idx: prompt.idx + 1, values });
              } else {
                const ctx: BindContext = {
                  data,
                  idParam: frame.idParam,
                  derivations: allDerivations(),
                };
                applyAction(runAction(prompt.binding, ctx, plugin, values));
                setPrompt(null);
              }
            }}
            onCancel={() => setPrompt(null)}
          />
        </Box>
      </Box>
    );
  }

  // detail mode: show the detail view with idParam from the stack.
  if (inDetail) {
    const detailSpec = resolveDetailSpec(frame.viewKey, specs, plugin);
    if (detailSpec) {
      const ctx: BindContext = { data, idParam: frame.idParam, derivations: allDerivations() };
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

  // List of views top to bottom. The interactive table gets the cursor.
  const ctx: BindContext = { data, idParam: frame.idParam, derivations: allDerivations() };
  return (
    <Box flexDirection="column">
      {specs.map((s, i) => {
        if (s.kind === "detail") return null; // detail is drawn by the stack, not in the list
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
