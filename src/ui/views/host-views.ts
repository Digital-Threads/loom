import type { ViewSpec } from "../../core/plugins/types.js";

// Host-вкладки (не плагинные). Обзор и Настройки определены как ViewSpec и рисуются
// тем же ViewRenderer, что и плагинные виды. Воспроизводят OverviewPanel/SettingsPanel.

// OverviewPanel: "Подписок: N", "Сессий: N", "Ошибок загрузки: N" (красным, только если >0).
export const overviewView: ViewSpec = {
  kind: "summary",
  lines: [
    { label: "Подписок", value: "subscriptions.length" },
    { label: "Сессий", value: "sessions.length" },
    { label: "Ошибок загрузки", value: "errors.length", color: "red", when: "errors.length" },
  ],
};

// SettingsPanel: форма читает loomRegistry (FormView сам это делает).
export const settingsView: ViewSpec = {
  kind: "form",
  source: "registry-settings",
};
