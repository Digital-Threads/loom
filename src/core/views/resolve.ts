import type { Bind, FieldRef } from "../plugins/types.js";
import type { WorkspaceData } from "../data/loader.js";
import { derivations } from "./derivations.js";

export interface BindContext {
  data: WorkspaceData;
  idParam?: string;
  row?: Record<string, unknown>;
  // Combined map of derivations (host + plugins). If provided, resolveBind resolves
  // {fn} against it; otherwise against host built-in derivations (the default for tests).
  derivations?: Record<string, (data: WorkspaceData, ...args: any[]) => unknown>;
}

// Special context keys: a string Bind/arg equal to one of these is read from ctx,
// not as a dotted path and not as a literal.
const CONTEXT_KEYS = new Set(["idParam", "taskId"]);

// Reads a value by dotted path. Supports ".length" on arrays/strings.
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

// Resolves a FieldRef string against the context.
// Root: special key "idParam"/"taskId" -> ctx.idParam; otherwise if there is a row and the first
// path segment is present in row -- resolve from row; otherwise from data.
export function resolveFieldRef(path: FieldRef, ctx: BindContext): unknown {
  if (CONTEXT_KEYS.has(path)) return ctx.idParam;
  const firstSeg = path.split(".")[0];
  if (ctx.row && Object.prototype.hasOwnProperty.call(ctx.row, firstSeg)) {
    return getDotted(ctx.row, path);
  }
  return getDotted(ctx.data, path);
}

// Resolves a Bind: a FieldRef string or {fn,args}.
// For {fn}: each arg is a FieldRef OR a literal. A string arg equal to a special key
// ("idParam"/"taskId") is taken from ctx.idParam; other strings are treated as literals
// (NOT as paths) -- ViewSpec args are always flat derivation parameters, not expressions.
// Numbers/booleans/etc. -- as-is. Unknown fn -> undefined (defensive, we don't throw).
export function resolveBind(
  bind: Bind,
  ctx: BindContext,
  derivationsMap: Record<string, (data: WorkspaceData, ...args: any[]) => unknown> =
    ctx.derivations ?? derivations,
): unknown {
  if (typeof bind === "string") {
    return resolveFieldRef(bind, ctx);
  }
  const fn = derivationsMap[bind.fn];
  if (!fn) return undefined;
  const args = (bind.args ?? []).map((arg) => {
    if (typeof arg === "string") {
      if (CONTEXT_KEYS.has(arg)) return ctx.idParam;
      return arg; // literal string
    }
    return arg; // number | boolean | literal
  });
  return fn(ctx.data, ...args);
}
