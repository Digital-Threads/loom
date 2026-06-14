#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPluginCli } from "./cli/plugin-cli.js";
import { runPackCli } from "./cli/pack-cli.js";
import { runConfigCli } from "./cli/config-cli.js";
import { defaultDeps } from "./core/install/runner.js";
import { serveApi, DEFAULT_PORT } from "./web/server.js";

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

function runServe(args: string[]): void {
  const portFlag = args.indexOf("--port");
  const port = portFlag >= 0 ? Number(args[portFlag + 1]) || DEFAULT_PORT : DEFAULT_PORT;
  const server = serveApi({ port, webDist: webDistDir() });
  const url = server.url?.toString() ?? `http://localhost:${port}/`;
  console.log(`Loom running at ${url}`);
  console.log("Press Ctrl+C to stop.");
  // Bun.serve keeps the process alive.
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "plugin": {
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
