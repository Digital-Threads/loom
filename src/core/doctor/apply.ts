import { readFileSync, existsSync } from "node:fs";
import { mergeConfigsFromObjects, type MergeRunResult } from "../merge/config-merge.js";
import { collectExpected } from "./collect.js";
import { settingsPathForScope } from "./scope.js";
import type { PluginContribution, ScopeDirs, ScopeName } from "./types.js";

export interface RunMergeOptions {
  scope: ScopeName;
  contributions: PluginContribution[];
  dirs: ScopeDirs;
  apply: boolean;
  backupPath?: string;
}

function readJsonDefensive(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function runMerge(opts: RunMergeOptions): MergeRunResult {
  const target = settingsPathForScope(opts.scope, opts.dirs);
  const current = readJsonDefensive(target);
  const { expected } = collectExpected(opts.contributions);
  return mergeConfigsFromObjects(
    target,
    [current, expected as unknown as Record<string, unknown>],
    { apply: opts.apply, backupPath: opts.backupPath },
  );
}
