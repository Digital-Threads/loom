// Lightweight i18n for the web UI. English is the source of truth; Russian is a
// translation overlay. Strings are keyed by flat dotted keys (e.g. "nav.board").
// Untranslated keys fall back to English, then to the key itself — t() never
// throws, so a missing translation degrades gracefully instead of crashing.
//
// Wiring: LangProvider reads `ui.language` from the settings API once on mount
// and exposes the active language plus a setter that persists the choice. Most
// components only need useT(): a (key) => string bound to the active language.

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LoomClient } from "./api";

export type Dict = Record<string, string>;

// Source strings. Every user-facing key the UI translates lives here in English;
// `ru` only overrides the ones with a Russian rendering.
const en: Dict = {
  // Left navigation — section labels.
  "nav.board": "Board",
  "nav.projects": "Projects",
  "nav.accounts": "Accounts",
  "nav.tokens": "Tokens",
  "nav.memory": "Memory",
  "nav.security": "Security",
  "nav.quality": "Quality",
  "nav.swarm": "Swarm",
  "nav.connectors": "Connectors",
  "nav.knowledge": "Knowledge",
  "nav.skills": "Skills",
  "nav.learning": "Learning",
  "nav.layers": "Layers",
  "nav.timeline": "Timeline",
  "nav.settings": "Settings",
  // Navigation group headers.
  "nav.group.modules": "Modules",
  "nav.group.connections": "Connections",
  "nav.group.capabilities": "Capabilities",
  "nav.group.more": "More",
  // Sidebar attention queue.
  "nav.attention": "Needs attention",

  // Section page titles (shown in the header). `nav.*` keys cover the matching
  // labels; these are the few titles that differ from the nav label.
  "section.connectors.title": "Connectors (MCP)",

  // Common, recurring action buttons.
  "action.send": "Send",
  "action.run": "Run",
  "action.approveContinue": "Approve & continue",
  "action.advance": "Advance",
  "action.changes": "Changes",
  "action.history": "History",
  "action.startTask": "Start task",
  "action.create": "Create",
  "action.cancel": "Cancel",
  "action.save": "Save",
  "action.delete": "Delete",

  // Settings panel labels.
  "settings.defaultRunMode": "Default run mode",
  "settings.language": "Language",
  "settings.costCap": "Cost cap (per task, $)",
  "settings.notifications": "Notifications",
  "settings.sandbox": "OS sandbox",
  "settings.flowDefaults": "Flow defaults",
  "settings.runMode.manual": "manual",
  "settings.runMode.gated": "gated",
  "settings.runMode.autopilot": "autopilot",
  "settings.on": "on",
  "settings.off": "off",

  // New task modal — field labels.
  "newTask.title": "Title",
  "newTask.repository": "Repository",
  "newTask.branch": "Branch",
  "newTask.description": "Description",
  "newTask.runMode": "Run mode",
  "newTask.qaDepth": "QA depth",
  "newTask.account": "Account",
};

const ru: Dict = {
  // Navigation labels.
  "nav.board": "Доска",
  "nav.projects": "Проекты",
  "nav.accounts": "Аккаунты",
  "nav.tokens": "Токены",
  "nav.memory": "Память",
  "nav.security": "Безопасность",
  "nav.quality": "Качество",
  "nav.swarm": "Рой",
  "nav.connectors": "Коннекторы",
  "nav.knowledge": "Знания",
  "nav.skills": "Навыки",
  "nav.learning": "Обучение",
  "nav.layers": "Слои",
  "nav.timeline": "Хронология",
  "nav.settings": "Настройки",
  // Navigation group headers.
  "nav.group.modules": "Модули",
  "nav.group.connections": "Подключения",
  "nav.group.capabilities": "Возможности",
  "nav.group.more": "Ещё",
  // Sidebar attention queue.
  "nav.attention": "Требует внимания",

  // Section page titles.
  "section.connectors.title": "Коннекторы (MCP)",

  // Action buttons.
  "action.send": "Отправить",
  "action.run": "Запустить",
  "action.approveContinue": "Принять и продолжить",
  "action.advance": "Дальше",
  "action.changes": "Изменения",
  "action.history": "История",
  "action.startTask": "Запустить задачу",
  "action.create": "Создать",
  "action.cancel": "Отмена",
  "action.save": "Сохранить",
  "action.delete": "Удалить",

  // Settings panel.
  "settings.defaultRunMode": "Режим запуска по умолчанию",
  "settings.language": "Язык",
  "settings.costCap": "Лимит стоимости (на задачу, $)",
  "settings.notifications": "Уведомления",
  "settings.sandbox": "Песочница ОС",
  "settings.flowDefaults": "Настройки пайплайна",
  "settings.runMode.manual": "вручную",
  "settings.runMode.gated": "с гейтами",
  "settings.runMode.autopilot": "автопилот",
  "settings.on": "вкл",
  "settings.off": "выкл",

  // New task modal.
  "newTask.title": "Название",
  "newTask.repository": "Репозиторий",
  "newTask.branch": "Ветка",
  "newTask.description": "Описание",
  "newTask.runMode": "Режим запуска",
  "newTask.qaDepth": "Глубина QA",
  "newTask.account": "Аккаунт",
};

const DICTS: Record<string, Dict> = { en, ru };

/**
 * Translate a key for a language. Falls back to the English source string, then
 * to the key itself. Never throws.
 */
export function t(key: string, lang: string): string {
  const dict = DICTS[lang];
  if (dict && key in dict) return dict[key];
  if (key in en) return en[key];
  return key;
}

interface LangCtx {
  lang: string;
  setLang: (l: string) => void;
}

const LangContext = createContext<LangCtx>({ lang: "en", setLang: () => {} });

/**
 * Provider mounted at the app root. Reads the persisted UI language once, then
 * exposes the active language and a setter that persists changes (so toggling
 * the language in Settings re-renders the whole tree instantly).
 */
export function LangProvider({ client, children }: { client: LoomClient; children: ReactNode }) {
  const [lang, setLangState] = useState<string>("en");

  useEffect(() => {
    let cancelled = false;
    client
      .settings()
      .then((s) => {
        const v = s["ui.language"];
        if (!cancelled && typeof v === "string" && v in DICTS) setLangState(v);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [client]);

  const value = useMemo<LangCtx>(
    () => ({
      lang,
      setLang: (l: string) => {
        setLangState(l);
        client.saveSetting("ui.language", l).catch(() => {});
      },
    }),
    [lang, client],
  );

  return createElement(LangContext.Provider, { value }, children);
}

/** Active language plus a persisting setter. */
export function useLang(): LangCtx {
  return useContext(LangContext);
}

/** A `t` bound to the active language: (key) => translated string. */
export function useT(): (key: string) => string {
  const { lang } = useContext(LangContext);
  return useMemo(() => (key: string) => t(key, lang), [lang]);
}
