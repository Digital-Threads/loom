import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression guard for the typecheck gate. An incremental `tsc -b` / `tsc --build`
// trusts .tsbuildinfo and can skip a real recheck, producing a false green (it once
// hid real errors in web/Tokens.tsx). The gate must never trust the cache: use
// `tsc --noEmit` (full recheck, no emit) or, if build mode is needed, `tsc -b --force`.

const readScripts = (relFromRepoRoot: string): Record<string, string> => {
  const p = fileURLToPath(new URL(`../../${relFromRepoRoot}`, import.meta.url));
  return (JSON.parse(readFileSync(p, "utf8")).scripts as Record<string, string>) ?? {};
};

// A sub-command runs tsc in build mode (`-b`, glued `-bv…`, or `--build`).
const isTscBuildMode = (seg: string) => /\btsc\b/.test(seg) && /(?:^|\s)(--build\b|-b[a-z]*\b)/.test(seg);

// A command "trusts the cache" if any sub-command runs build-mode tsc without
// --force. Split on shell separators so `--force` only counts when it belongs to
// the same sub-command as tsc (e.g. `tsc -b && cp x --force` is still unsafe).
const trustsCache = (cmd: string) =>
  cmd.split(/&&|\|\||;|\|/).some((seg) => isTscBuildMode(seg) && !/--force\b/.test(seg));

describe("typecheck gate cannot give a false green", () => {
  for (const manifest of ["package.json", "web/package.json"]) {
    it(`${manifest}: no script uses cache-trusting "tsc -b" without --force`, () => {
      const scripts = readScripts(manifest);
      const offenders = Object.entries(scripts).filter(([, cmd]) => trustsCache(cmd));
      expect(offenders).toEqual([]);
    });
  }

  it("web build runs a non-cached typecheck", () => {
    const build = readScripts("web/package.json").build ?? "";
    const checks = /tsc\s+--noEmit\b/.test(build) || /\btsc\s+(-b|--build)\b.*--force\b/.test(build);
    expect(checks).toBe(true);
  });
});
