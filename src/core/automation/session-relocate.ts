// Claude stores a session transcript at <configDir>/projects/<slug>/<id>.jsonl.
// A session created under one account's config dir can't be `--resume`d under a
// different profile's config dir — the file simply isn't there. So switching the
// account mid-task (rate-limit recovery) must first copy the session into the
// target profile's config dir; then `--resume <id>` lands on the SAME session
// but runs under the new account. Pure fs + injectable for tests.

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";

/** Find the session file under `<root>/projects/<slug>/<sessionId>.jsonl`, or null. */
function findSession(root: string, sessionId: string): string | null {
  const projects = join(root, "projects");
  if (!existsSync(projects)) return null;
  for (const sub of readdirSync(projects)) {
    const f = join(projects, sub, `${sessionId}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

/** Ensure the session transcript exists under `targetConfigDir` so a `--resume`
 *  there finds it. Searches `configDirs` for the file and copies it across,
 *  preserving the project sub-dir. Returns true if the session is now present
 *  under the target (already there, or copied); false if it couldn't be found. */
export function relocateSession(sessionId: string, configDirs: string[], targetConfigDir: string): boolean {
  if (findSession(targetConfigDir, sessionId)) return true; // already there
  for (const dir of configDirs) {
    if (dir === targetConfigDir) continue;
    const src = findSession(dir, sessionId);
    if (!src) continue;
    const sub = basename(dirname(src));
    const dest = join(targetConfigDir, "projects", sub, `${sessionId}.jsonl`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    return true;
  }
  return false;
}
