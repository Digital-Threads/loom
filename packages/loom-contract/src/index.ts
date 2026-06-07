// @digital-threads/loom-contract — ТОЛЬКО типы контракта Loom-плагина.
// Без рантайм-значений: tsc резолвит эти типы через "types"-поле package.json,
// type-импорты эрейзятся, билд пакета не нужен.
//
// Рантайм-логика хоста (LOOM_CONTRACT_VERSION, validateManifest, loader, views,
// derivations, metrics) ОСТАЁТСЯ в loom-host — это не контракт.

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
  // Одно-плагинные деривации для {fn} в view-спеках — знают схему событий своего плагина.
  // data — WorkspaceData в рантайме хоста; в types-only контракте тип unknown,
  // чтобы не тащить WorkspaceData в этот пакет.
  derivations?: Record<string, (data: unknown, ...args: unknown[]) => unknown>;
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
  marker?: { when: FieldRef; truthy: string; falsy?: string; equals?: string | number | boolean }; // ★ / ✓○
  // equals задан → маркер truthy при value === equals (статус задач: "closed" → "✓").
  // equals не задан → старое truthy-поведение Boolean(value) (для isSource подписок).
}

export interface ActionBinding {
  key: string;                          // "c","t"
  actionId: string;                     // resolves loomRegistry.get(pluginId).actions
  args?: Record<string, Bind>;          // static path ИЛИ computed
  label?: string;                       // легенда хоткеев
  confirmPrompt?: string;               // текст y/n-подтверждения (для паритета с панелями)
}                                        // нужно ли подтверждение — читается из PluginAction.confirm

export interface SummaryView {
  kind: "summary";
  lines: { label: string; value: Bind; color?: string; when?: FieldRef }[];
}

export interface TableView {
  kind: "table";
  source: Bind;                         // путь к массиву ("sessions") ИЛИ деривация ({fn:"sessionsWithTokens"})
  rowKey: FieldRef;                     // напр "sessionId"
  columns: Column[];
  empty?: string;
  gap?: number;                         // число пробелов-разделителей между колонками (по умолчанию 2)
  selectable?: boolean;                 // включает ↑/↓ + Enter
  onSelect?: { openView: string; passId: FieldRef };  // list→detail
  actions?: ActionBinding[];
}

export interface DetailSection {
  label: string;
  items: Bind;                          // массив (путь или {fn})
  itemText: FieldRef;                   // путь внутри item, напр "text"
  empty?: string;
  note?: string;                        // dim-суффикс у заголовка (напр. «(эвристика по времени)»)
  hideCount?: boolean;                  // не показывать «(N)» у заголовка (блок «Токены задачи»)
  lead?: Bind;                          // строка под заголовком без буллета (итог токенов)
  trailer?: Bind;                       // dim-строка после списка (рендерится только если непустая)
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

// ── Манифест плагина (тип) ───────────────────────────────────────────────────
// Только interface. LOOM_CONTRACT_VERSION и validateManifest — рантайм-логика хоста,
// остаются в loom-host/src/core/plugins/manifest.ts.
export interface LoomPluginManifest {
  // идентификация
  schemaVersion: 1; // версия формата манифеста
  type: "loom-plugin"; // дискриминатор
  name: string; // = LoomPlugin.id, уникален
  title: string; // отображаемое
  version: string; // semver кода плагина
  apiVersion: string; // версия контракта LoomPlugin ("^1.0")
  description?: string;
  author?: { name: string; email?: string; url?: string };
  keywords?: string[];

  // загрузка кода
  entry: string; // путь к собранному ESM, напр "./dist/adapter.js"
  export?: string; // имя экспорта, default "plugin"

  // что привносит — для preview/меню/прав ДО динамического import()
  provides: {
    tabs: { id: string; title: string }[];
    settings?: boolean;
    actions?: { id: string; label: string }[];
  };

  // права (декларативно; формат verb:target). v1 — хранятся+показываются, НЕ enforced.
  permissions?: string[];

  // связь с реальным CC-плагином
  claudePlugin?: {
    name: string;
    marketplace: string;
    source?: string | { source: "github"; repo: string };
  };
}
