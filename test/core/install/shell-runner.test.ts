import { expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeShellRunner } from "../../../src/core/install/shell-runner.js";

it("runs a command and returns its stdout", () => {
  const r = makeShellRunner()("node", ["-e", "process.stdout.write('hi')"]);
  expect(r.ok).toBe(true);
  expect(r.stdout).toBe("hi");
});

it("a missing binary -> ok:false, does not throw", () => {
  const r = makeShellRunner()("loom-no-such-binary-xyz", []);
  expect(r.ok).toBe(false);
});

it("runs a shell pipe via sh -c (rustup's curl | sh shape)", () => {
  const r = makeShellRunner()("sh", ["-c", "echo one | tr a-z A-Z"]);
  expect(r.ok).toBe(true);
  expect(r.stdout.trim()).toBe("ONE");
});

it("prepends ~/.cargo/bin to the child PATH so a freshly-installed cargo is visible", () => {
  const r = makeShellRunner()("sh", ["-c", "echo $PATH"]);
  expect(r.stdout).toContain(join(homedir(), ".cargo", "bin"));
});
