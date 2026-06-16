// In-UI profile authorization. `aimux auth login <name>` wraps the interactive
// `claude auth login` (browser OAuth, hosted callback at platform.claude.com →
// the user copies a code). The CLI only runs/prints under a TTY, so we spawn it
// through the system `script` PTY wrapper (no native node-pty dependency),
// scrape the auth URL from its output, and feed the pasted code back to stdin.
// On success the CLI writes .credentials.json into the profile dir → done.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, expandHome } from "@digital-threads/aimux/core";

export type AuthStatus = "starting" | "awaiting_code" | "done" | "error";

export interface ProcLike {
  stdout: { on(ev: "data", cb: (d: Buffer | string) => void): void };
  stdin: { write(s: string): void };
  on(ev: "exit" | "error", cb: (arg?: unknown) => void): void;
  kill(): void;
}
export type SpawnAuth = (name: string) => ProcLike;

interface AuthSession {
  id: string;
  proc: ProcLike;
  buf: string;
  url?: string;
  status: AuthStatus;
  error?: string;
  profilePath: string;
}

export interface AuthView {
  status: AuthStatus;
  url?: string;
  authorized: boolean;
  error?: string;
}

const URL_RE = /(https:\/\/\S*oauth\/authorize\S*)/i;
const VALID_NAME = /^[A-Za-z0-9._-]+$/;

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "\n");
}

function defaultSpawn(name: string): ProcLike {
  if (!VALID_NAME.test(name)) throw new Error(`invalid profile name: ${name}`);
  // script -q (quiet) -f (flush) -e (return child's exit code) -c <cmd> <typescript>
  return spawn("script", ["-qfec", `aimux auth login ${name}`, "/dev/null"], {
    stdio: ["pipe", "pipe", "pipe"],
  }) as unknown as ProcLike;
}

function defaultProfilePath(name: string): string {
  const cfg = loadConfig();
  const p = cfg?.profiles[name];
  return p ? expandHome(p.path) : "";
}

export interface AuthManagerDeps {
  spawnAuth?: SpawnAuth;
  profilePath?: (name: string) => string;
  credsExist?: (profilePath: string) => boolean;
}

export function createAuthManager(deps: AuthManagerDeps = {}) {
  const sessions = new Map<string, AuthSession>();
  const spawnAuth = deps.spawnAuth ?? defaultSpawn;
  const profilePathOf = deps.profilePath ?? defaultProfilePath;
  const credsExist = deps.credsExist ?? ((p) => !!p && existsSync(join(p, ".credentials.json")));

  function start(name: string): string {
    // Unguessable capability token (128-bit CSPRNG); the profile name is kept in
    // the session map only, never in the id, so sessions aren't enumerable.
    const id = `auth-${randomBytes(16).toString("hex")}`;
    const proc = spawnAuth(name); // throws on invalid name → caller maps to 400
    const s: AuthSession = { id, proc, buf: "", status: "starting", profilePath: profilePathOf(name) };
    sessions.set(id, s);
    proc.stdout.on("data", (d) => {
      s.buf += stripAnsi(d.toString());
      if (!s.url) {
        const m = URL_RE.exec(s.buf);
        if (m) { s.url = m[1]; s.status = "awaiting_code"; }
      }
    });
    proc.on("exit", () => {
      s.status = credsExist(s.profilePath) ? "done" : "error";
      if (s.status === "error" && !s.error) s.error = "authorization did not complete";
    });
    proc.on("error", () => { s.status = "error"; s.error = "failed to launch aimux auth login"; });
    return id;
  }

  function submitCode(id: string, code: string): boolean {
    const s = sessions.get(id);
    if (!s) return false;
    s.proc.stdin.write(`${code.trim()}\n`);
    return true;
  }

  function get(id: string): AuthView | null {
    const s = sessions.get(id);
    if (!s) return null;
    return { status: s.status, url: s.url, authorized: s.status === "done", error: s.error };
  }

  function cancel(id: string): void {
    const s = sessions.get(id);
    if (!s) return;
    try { s.proc.kill(); } catch { /* already gone */ }
    sessions.delete(id);
  }

  return { start, submitCode, get, cancel };
}
