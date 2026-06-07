import type { Bind, FieldRef } from "../plugins/types.js";
import type { WorkspaceData } from "../data/loader.js";
import { derivations } from "./derivations.js";

export interface BindContext {
  data: WorkspaceData;
  idParam?: string;
  row?: Record<string, unknown>;
}

// Спец-ключи контекста: строковый Bind/arg, равный одному из них, читается из ctx,
// а не как dotted-путь и не как литерал.
const CONTEXT_KEYS = new Set(["idParam", "taskId"]);

// Достаёт значение по dotted-пути. Поддерживает ".length" на массивах/строках.
export function getDotted(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (part === "length" && (Array.isArray(cur) || typeof cur === "string")) {
      cur = (cur as { length: number }).length;
      continue;
    }
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// Резолвит FieldRef-строку против контекста.
// Корень: спец-ключ "idParam"/"taskId" → ctx.idParam; иначе если есть row и первый
// сегмент пути присутствует в row — резолв от row; иначе от data.
export function resolveFieldRef(path: FieldRef, ctx: BindContext): unknown {
  if (CONTEXT_KEYS.has(path)) return ctx.idParam;
  const firstSeg = path.split(".")[0];
  if (ctx.row && Object.prototype.hasOwnProperty.call(ctx.row, firstSeg)) {
    return getDotted(ctx.row, path);
  }
  return getDotted(ctx.data, path);
}

// Резолвит Bind: FieldRef-строку или {fn,args}.
// Для {fn}: каждый arg — FieldRef ИЛИ литерал. Строковый arg, равный спец-ключу
// ("idParam"/"taskId"), берётся из ctx.idParam; прочие строки трактуются как литералы
// (а НЕ как пути) — args в ViewSpec всегда плоские параметры деривации, не выражения.
// Числа/булевы/прочее — как есть. Неизвестный fn → undefined (defensive, не бросаем).
export function resolveBind(bind: Bind, ctx: BindContext): unknown {
  if (typeof bind === "string") {
    return resolveFieldRef(bind, ctx);
  }
  const fn = derivations[bind.fn];
  if (!fn) return undefined;
  const args = (bind.args ?? []).map((arg) => {
    if (typeof arg === "string") {
      if (CONTEXT_KEYS.has(arg)) return ctx.idParam;
      return arg; // литерал-строка
    }
    return arg; // number | boolean | литерал
  });
  return fn(ctx.data, ...args);
}
