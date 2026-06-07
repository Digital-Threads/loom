import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { CliResult } from "./plugin-cli.js";
import { collectPackInput, type CollectDeps } from "../core/pack/collect-pack.js";
import { buildPack } from "../core/pack/build-pack.js";

export interface PackCliDeps extends CollectDeps {
  writeFile?: (path: string, content: string) => void;
  copyToClipboard?: (content: string) => void;
}

function defaultWriteFile(path: string, content: string): void { writeFileSync(path, content, "utf8"); }
function defaultCopy(content: string): void {
  const plat = process.platform;
  const cmd = plat === "darwin" ? "pbcopy" : plat === "win32" ? "clip" : "xclip -selection clipboard";
  execSync(cmd, { input: content });
}

export async function runPackCli(args: string[], deps: PackCliDeps = {}): Promise<CliResult> {
  try {
    const input = await collectPackInput(deps);
    const md = buildPack(input);
    const outIdx = args.indexOf("--out");
    if (outIdx !== -1) {
      const path = args[outIdx + 1];
      if (!path) return { code: 1, lines: ["loom pack --out: укажите путь"] };
      (deps.writeFile ?? defaultWriteFile)(path, md);
      return { code: 0, lines: [`pack записан: ${path}`] };
    }
    if (args.includes("--copy")) {
      try {
        (deps.copyToClipboard ?? defaultCopy)(md);
        return { code: 0, lines: ["pack скопирован в буфер обмена"] };
      } catch (e) {
        return { code: 0, lines: [`⚠ буфер недоступен (${(e as Error).message}); вывод ниже:`, "", ...md.split("\n")] };
      }
    }
    if (args.some((a) => a.startsWith("--") && a !== "--out" && a !== "--copy")) {
      return { code: 1, lines: ["loom pack: неизвестный флаг", "usage: loom pack [--out <file>] [--copy]"] };
    }
    return { code: 0, lines: md.split("\n") };
  } catch (err) {
    return { code: 1, lines: [`Ошибка pack: ${(err as Error).message}`] };
  }
}
