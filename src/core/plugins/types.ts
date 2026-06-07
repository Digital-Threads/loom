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

export interface LoomPlugin {
  id: string;
  title: string;
  tabs: string[];
  settingsSchema?: SettingsSchema;
}
