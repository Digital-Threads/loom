import { describe, it, expect } from "vitest";
import { detectSandbox, wrapCommand } from "../../../src/core/security/os-sandbox.js";

describe("os-sandbox (experimental, opt-in)", () => {
  it("detects the backend per platform + availability", () => {
    expect(detectSandbox("linux", (c) => c === "bwrap")).toBe("bubblewrap");
    expect(detectSandbox("darwin", (c) => c === "sandbox-exec")).toBe("sandbox-exec");
    expect(detectSandbox("linux", () => false)).toBe("none");
    expect(detectSandbox("win32", () => true)).toBe("none");
  });

  it("none → passthrough (command unchanged)", () => {
    expect(wrapCommand("none", "claude", ["-p"], "/wt")).toEqual({ cli: "claude", args: ["-p"] });
  });

  it("bubblewrap confines writes to the worktree, keeps net + read-only host", () => {
    const w = wrapCommand("bubblewrap", "claude", ["-p", "--resume", "x"], "/wt");
    expect(w.cli).toBe("bwrap");
    expect(w.args).toContain("--share-net"); // model API reachable
    expect(w.args.join(" ")).toContain("--ro-bind / /"); // read-only host
    expect(w.args.join(" ")).toContain("--bind /wt /wt"); // writable worktree
    // the real command is preserved after `--`
    const sep = w.args.indexOf("--");
    expect(w.args.slice(sep + 1)).toEqual(["claude", "-p", "--resume", "x"]);
  });

  it("sandbox-exec denies writes outside the worktree", () => {
    const w = wrapCommand("sandbox-exec", "claude", ["-p"], "/wt");
    expect(w.cli).toBe("sandbox-exec");
    expect(w.args[0]).toBe("-p");
    expect(w.args[1]).toContain('(deny file-write* (subpath "/"))');
    expect(w.args[1]).toContain("/wt");
    expect(w.args.slice(2)).toEqual(["claude", "-p"]);
  });
});
