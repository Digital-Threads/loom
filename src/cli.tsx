#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPluginCli } from "./cli/plugin-cli.js";
import { runPackCli } from "./cli/pack-cli.js";
import { runConfigCli } from "./cli/config-cli.js";
import { spawn } from "node:child_process";
import { defaultDeps } from "./core/install/runner.js";
import { serveApi, DEFAULT_PORT } from "./web/server.js";
import { parseServeArgs } from "./cli/serve-args.js";
import { runPluginNew } from "./cli/plugin-new.js";

const HELP = `Loom — AI orchestrator
Usage:
  loom [serve]            Start the app (API + web UI), default
  loom serve [--port N]   Start on a specific port
  loom plugin <add|remove|list>
  loom pack [--out <file>] [--copy]
  loom config <doctor|merge>`;

function webDistDir(): string {
  // src/cli.tsx → ../web/dist (built frontend).
  return join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best-effort */
  }
}

function runServe(args: string[]): void {
  const { port, open, project } = parseServeArgs(args, DEFAULT_PORT);
  if (project) process.chdir(project);
  const server = serveApi({ port, webDist: webDistDir() });
  const url = server.url?.toString() ?? `http://localhost:${port}/`;
  console.log(`Loom running at ${url}`);
  if (open) openBrowser(url);
  console.log("Press Ctrl+C to stop.");
  // Bun.serve keeps the process alive.
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "plugin": {
      if (rest[0] === "new") {
        const name = rest[1];
        if (!name) { console.error("usage: loom plugin new <name>"); process.exit(1); }
        const written = runPluginNew(name, process.cwd());
        written.forEach((p) => console.log(`created ${p}`));
        process.exit(0);
      }
      const res = runPluginCli(rest, defaultDeps());
      res.lines.forEach((l) => console.log(l));
      process.exit(res.code);
    }
    case "pack": {
      const res = await runPackCli(rest, {});
      res.lines.forEach((l) => console.log(l));
      process.exit(res.code);
    }
    case "config": {
      const res = runConfigCli(rest, {});
      res.lines.forEach((l) => console.log(l));
      process.exit(res.code);
    }
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      process.exit(0);
    case undefined:
    case "serve":
      runServe(rest);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

await main();
