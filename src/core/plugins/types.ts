export type SettingFieldType = "string" | "number" | "boolean" | "enum";

export interface SettingField {
  key: string;          // плоский или dotted-путь, напр. "hooks.mode"
  label: string;
  type: SettingFieldType;
  options?: string[];   // только для type==="enum"
  readonly?: boolean;   // string-поля token-pilot («правьте файл») → не редактируются в UI
}

export interface SettingsSchema {
  fields: SettingField[];
}

export interface LoomContext {
  projectRoot: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface PluginAction {
  id: string;
  label: string;
  confirm?: boolean; // необратимое действие → требует подтверждения в UI
  run(ctx: LoomContext, args?: Record<string, unknown>): ActionResult;
}

export interface PluginSettings {
  schema: SettingsSchema;
  read(ctx: LoomContext): Record<string, unknown>;
  write(ctx: LoomContext, updates: Record<string, unknown>): boolean;
}

export interface PluginTab {
  id: string;    // стабильный id вкладки
  title: string; // отображаемое имя
}

// data source абстрагирован за load(): плагин сам знает способ (core-import / файл / CLI)
export interface LoomPlugin<TData = unknown> {
  id: string;
  title: string;
  tabs: PluginTab[];                                 // вкладки, которые вносит плагин
  load(ctx: LoomContext): TData | Promise<TData>;    // забор данных плагина
  settings?: PluginSettings;
  actions?: PluginAction[];
  views?: Record<string, ViewSpec | ViewSpec[]>;     // ключ = PluginTab.id; массив = виды сверху-вниз
}

// ── Декларативная view-схема (Task 7.2) ──────────────────────────────────────
// Плагин описывает вкладку как данные (ViewSpec); хост рисует обобщённым рендерером.

export type FieldRef = string;          // dotted-путь в контексте вида
export type Bind = FieldRef | { fn: string; args?: (FieldRef | string | number | boolean)[] };
// Bind резолвится против контекста: WorkspaceData + (для detail) idParam + (для action) выбранная строка.
// FieldRef "x.y" → путь; {fn} → derivations[fn](data, ...resolvedArgs).

export interface Column {
  header?: string;
  value: FieldRef;                      // путь в строке
  width?: number;
  align?: "left" | "right";
  marker?: { when: FieldRef; truthy: string; falsy?: string }; // ★ / ✓○
}

export interface ActionBinding {
  key: string;                          // "c","t"
  actionId: string;                     // resolves loomRegistry.get(pluginId).actions
  args?: Record<string, Bind>;          // static path ИЛИ computed
  label?: string;                       // легенда хоткеев
}                                        // confirm читается из PluginAction.confirm

export interface SummaryView {
  kind: "summary";
  lines: { label: string; value: Bind; color?: string; when?: FieldRef }[];
}

export interface TableView {
  kind: "table";
  source: FieldRef;                     // путь к массиву, напр "sessions"
  rowKey: FieldRef;                     // напр "sessionId"
  columns: Column[];
  empty?: string;
  selectable?: boolean;                 // включает ↑/↓ + Enter
  onSelect?: { openView: string; passId: FieldRef };  // list→detail
  actions?: ActionBinding[];
}

export interface DetailSection {
  label: string;
  items: Bind;                          // массив (путь или {fn})
  itemText: FieldRef;                   // путь внутри item, напр "text"
  empty?: string;
}

export interface DetailView {
  kind: "detail";
  idParam: string;                      // прокинут из table.onSelect.passId
  title: Bind;
  sections: DetailSection[];
  scalars?: { label: string; value: Bind }[];  // блок «Токены задачи»
  actions?: ActionBinding[];
}

export interface FormView {
  kind: "form";
  source: "registry-settings";         // спец: хост читает loomRegistry
}

export type ViewSpec = SummaryView | TableView | DetailView | FormView;
