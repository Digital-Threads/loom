// Чистая машина навигации обобщённого ViewRenderer. Без Ink, без данных, без мутаций:
// меняет только состояние навигации/режима. РЕШЕНИЕ вызывать action принимает Ink-слой,
// глядя на mode/confirmKey. Это поднятая в данные логика TasksPanel/SettingsPanel.

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
  confirmKey: string | null; // ActionBinding.key, по которому висит подтверждение
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
  // Длина текущего списка для clamp курсора (table/form). 0 → курсор остаётся 0.
  listLength: number;
  // true → Enter на текущей строке ведёт в detail (table.onSelect). Слой сам делает push.
  hasOnSelect?: boolean;
  // viewKey + idParam для push в стек при Enter (если hasOnSelect).
  openView?: string;
  selectedId?: string;
  // true → текущее выбранное поле формы — number (Enter → editNumber-режим).
  enterEditsNumber?: boolean;
  // initial-значение буфера при входе в editNumber (текущее значение поля).
  editInitial?: string;
  // требует ли action с этим ключом подтверждения (PluginAction.confirm).
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
  // ── confirm-режим ──────────────────────────────────────────────────────────
  if (state.mode === "confirm") {
    switch (event.type) {
      case "confirmYes":
        // Слой исполняет action на confirmYes, затем шлёт setStatus. Здесь — выход в nav.
        return { ...state, mode: "nav", confirmKey: null };
      case "confirmNo":
      case "esc":
        return { ...state, mode: "nav", confirmKey: null, status: "отмена" };
      case "setStatus":
        return { ...state, mode: "nav", confirmKey: null, status: event.text };
      default:
        return state;
    }
  }

  // ── editNumber-режим ────────────────────────────────────────────────────────
  if (state.mode === "editNumber") {
    switch (event.type) {
      case "esc":
        return { ...state, mode: "nav", editBuffer: "", status: "отмена" };
      case "backspace":
        return { ...state, editBuffer: state.editBuffer.slice(0, -1) };
      case "char":
        if (/^[0-9]$/.test(event.char)) {
          return { ...state, editBuffer: state.editBuffer + event.char };
        }
        return state;
      case "enter":
        // Пустой буфер → отмена. Иначе слой читает editBuffer и пишет значение.
        if (state.editBuffer === "") {
          return { ...state, mode: "nav", status: "отмена" };
        }
        return { ...state, mode: "nav", editBuffer: "" };
      case "setStatus":
        return { ...state, status: event.text };
      default:
        return state;
    }
  }

  // ── nav-режим ───────────────────────────────────────────────────────────────
  switch (event.type) {
    case "up":
      return { ...state, cursor: clampCursor(state.cursor - 1, opts.listLength) };
    case "down":
      return { ...state, cursor: clampCursor(state.cursor + 1, opts.listLength) };
    case "enter": {
      if (opts.hasOnSelect && opts.openView) {
        // list→detail: push нового кадра, курсор сбрасываем.
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
      // pop стека (закрыть detail). Корень не закрываем.
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
      // Без confirm: слой исполняет action сам и пришлёт setStatus. Стейт не меняем.
      return state;
    }
    case "setStatus":
      return { ...state, status: event.text };
    default:
      return state;
  }
}
