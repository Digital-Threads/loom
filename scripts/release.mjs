#!/usr/bin/env node
/* Bulletproof publish.
 *
 * `npm publish` is supposed to run prepack/postpack (which swap the sibling
 * `file:..` deps to their registry versions), but on some npm versions the
 * uploaded tarball ends up with the raw `file:../aimux` — a path that does not
 * exist on a user's machine, so a clean install breaks.
 *
 * `npm pack` DOES apply the swap reliably. So we pack first (producing a tarball
 * with `^x.y.z` deps) and then publish THAT exact tarball — publishing a prebuilt
 * `.tgz` does not re-run the pack lifecycle, so nothing can put `file:..` back. */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// npm is npm.cmd on Windows; no shell is used, so paths/args can't be injected.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tgz = join(root, `${name.replace("@", "").replace("/", "-")}-${version}.tgz`);

console.log(`▸ building ${name}@${version}`);
execFileSync(npm, ["run", "build"], { cwd: root, stdio: "inherit" });
console.log(`▸ packing (swaps file:.. deps → registry versions)`);
execFileSync(npm, ["pack"], { cwd: root, stdio: "inherit" });
if (!existsSync(tgz)) throw new Error(`release: expected tarball ${tgz} was not produced`);

console.log(`▸ publishing ${tgz}`);
execFileSync(npm, ["publish", tgz], { cwd: root, stdio: "inherit" });
rmSync(tgz, { force: true });
console.log(`✓ published ${name}@${version}`);
