export type SettingFieldType = "string" | "number" | "boolean" | "enum";

export interface SettingField {
  key: string;          // плоский или dotted-путь, напр. "hooks.mode"
  label: string;
  type: SettingFieldType;
  options?: string[];   // только для type==="enum"
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
}
