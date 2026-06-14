// Server-side directory browser for the web UI's folder pickers (new task repo,
// add project). The browser can't read the local filesystem, so the host lists
// directories on request. Read-only, directories only, with a git-repo flag so
// the picker can highlight valid repos. Hidden dirs (dotfiles) are skipped
// except none are special-cased — node_modules is hidden to keep lists usable.

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, parse } from "node:path";
import { homedir } from "node:os";

export interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface BrowseResult {
  /** The resolved absolute path that was listed. */
  path: string;
  /** Parent directory, or null at the filesystem root. */
  parent: string | null;
  entries: DirEntry[];
}

const HIDDEN = new Set(["node_modules", ".git"]);

/** List immediate sub-directories of `path` (default: home dir). */
export function browseDir(path?: string): BrowseResult {
  const target = path && path.trim() ? path : homedir();
  const root = parse(target).root;
  const parent = target === root ? null : dirname(target);
  let entries: DirEntry[] = [];
  try {
    entries = readdirSync(target)
      .filter((name) => !name.startsWith(".") && !HIDDEN.has(name))
      .map((name) => join(target, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      })
      .map((p) => ({ name: p.slice(target.length).replace(/^[/\\]/, ""), path: p, isGitRepo: existsSync(join(p, ".git")) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    entries = [];
  }
  return { path: target, parent, entries };
}
