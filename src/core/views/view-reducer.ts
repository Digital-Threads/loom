// Pure navigation machine for the generic ViewRenderer. No Ink, no data, no mutations:
// it only changes navigation/mode state. The DECISION to invoke an action is made by the Ink layer,
// looking at mode/confirmKey. This is the TasksPanel/SettingsPanel logic lifted into data.

export type ViewMode = "nav" | "editNumber" | "confirm";

export interface ViewStackFrame {
  viewKey: string;
  idParam?: string;
}

export interface ViewState {
  stack: ViewStackFrame[];
  cursor: number;
  mode: ViewMode;
  editBuffer: string;
  confirmKey: string | null; // ActionBinding.key the confirmation is pending on
  status: string;
}

export type ViewEvent =
  | { type: "up" }
  | { type: "down" }
  | { type: "enter" }
  | { type: "esc" }
  | { type: "char"; char: string }
  | { type: "backspace" }
  | { type: "actionKey"; key: string }
  | { type: "confirmYes" }
  | { type: "confirmNo" }
  | { type: "setStatus"; text: string };

export interface ViewReducerOpts {
  // Length of the current list to clamp the cursor (table/form). 0 -> cursor stays 0.
  listLength: number;
  // true -> Enter on the current row leads into detail (table.onSelect). The layer does the push itself.
  hasOnSelect?: boolean;
  // viewKey + idParam to push onto the stack on Enter (if hasOnSelect).
  openView?: string;
  selectedId?: string;
  // true -> the currently selected form field is a number (Enter -> editNumber mode).
  enterEditsNumber?: boolean;
  // initial buffer value on entering editNumber (the field's current value).
  editInitial?: string;
  // whether the action with this key requires confirmation (PluginAction.confirm).
  confirmKeys?: Record<string, boolean>;
}

export function initialViewState(rootViewKey: string, idParam?: string): ViewState {
  return {
    stack: [{ viewKey: rootViewKey, idParam }],
    cursor: 0,
    mode: "nav",
    editBuffer: "",
    confirmKey: null,
    status: "",
  };
}

function clampCursor(cursor: number, listLength: number): number {
  if (listLength <= 0) return 0;
  return Math.max(0, Math.min(listLength - 1, cursor));
}

export function viewReducer(state: ViewState, event: ViewEvent, opts: ViewReducerOpts): ViewState {
  // -- confirm mode --------------------------------------------------------------
  if (state.mode === "confirm") {
    switch (event.type) {
      case "confirmYes":
        // The layer runs the action on confirmYes, then sends setStatus. Here -- exit to nav.
        return { ...state, mode: "nav", confirmKey: null };
      case "confirmNo":
      case "esc":
        return { ...state, mode: "nav", confirmKey: null, status: "cancelled" };
      case "setStatus":
        return { ...state, mode: "nav", confirmKey: null, status: event.text };
      default:
        return state;
    }
  }

  // -- editNumber mode -----------------------------------------------------------
  if (state.mode === "editNumber") {
    switch (event.type) {
      case "esc":
        return { ...state, mode: "nav", editBuffer: "", status: "cancelled" };
      case "backspace":
        return { ...state, editBuffer: state.editBuffer.slice(0, -1) };
      case "char":
        if (/^[0-9]$/.test(event.char)) {
          return { ...state, editBuffer: state.editBuffer + event.char };
        }
        return state;
      case "enter":
        // Empty buffer -> cancel. Otherwise the layer reads editBuffer and writes the value.
        if (state.editBuffer === "") {
          return { ...state, mode: "nav", status: "cancelled" };
        }
        return { ...state, mode: "nav", editBuffer: "" };
      case "setStatus":
        return { ...state, status: event.text };
      default:
        return state;
    }
  }

  // -- nav mode --------------------------------------------------------------------
  switch (event.type) {
    case "up":
      return { ...state, cursor: clampCursor(state.cursor - 1, opts.listLength) };
    case "down":
      return { ...state, cursor: clampCursor(state.cursor + 1, opts.listLength) };
    case "enter": {
      if (opts.hasOnSelect && opts.openView) {
        // list->detail: push a new frame, reset the cursor.
        return {
          ...state,
          stack: [...state.stack, { viewKey: opts.openView, idParam: opts.selectedId }],
          cursor: 0,
          status: "",
        };
      }
      if (opts.enterEditsNumber) {
        return { ...state, mode: "editNumber", editBuffer: opts.editInitial ?? "" };
      }
      return state;
    }
    case "esc": {
      // pop the stack (close detail). We don't close the root.
      if (state.stack.length > 1) {
        return { ...state, stack: state.stack.slice(0, -1), cursor: 0, status: "" };
      }
      return state;
    }
    case "actionKey": {
      const needsConfirm = opts.confirmKeys?.[event.key] ?? false;
      if (needsConfirm) {
        return { ...state, mode: "confirm", confirmKey: event.key };
      }
      // No confirm: the layer runs the action itself and will send setStatus. We don't change state.
      return state;
    }
    case "setStatus":
      return { ...state, status: event.text };
    default:
      return state;
  }
}
