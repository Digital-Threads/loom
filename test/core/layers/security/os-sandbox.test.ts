import { describe, it, expect } from "vitest";
import { detectSandbox, wrapCommand, sandboxUsable } from "../../../../src/core/layers/security/os-sandbox.js";

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
    // ORDER: --ro-bind / / must come BEFORE --dev-bind/--proc, else it re-binds the
    // host's read-only /dev over the special one and the Bun-based claude segfaults.
    const roIdx = w.args.indexOf("--ro-bind");
    const devIdx = w.args.indexOf("--dev-bind");
    const procIdx = w.args.indexOf("--proc");
    expect(roIdx).toBeGreaterThanOrEqual(0);
    expect(roIdx).toBeLessThan(devIdx); // ro-bind before dev-bind
    expect(roIdx).toBeLessThan(procIdx); // ro-bind before proc
    // the real command is preserved after `--`
    const sep = w.args.indexOf("--");
    expect(w.args.slice(sep + 1)).toEqual(["claude", "-p", "--resume", "x"]);
  });

  it("binds the extra writable carve-outs (so ~/.claude stays writable for --resume)", () => {
    const w = wrapCommand("bubblewrap", "claude", ["-p"], "/wt", ["/home/u/.claude", "/tmp", "/wt"]);
    const s = w.args.join(" ");
    expect(s).toContain("--bind /wt /wt"); // worktree first
    expect(s).toContain("--bind /home/u/.claude /home/u/.claude"); // session state writable
    expect(s).toContain("--bind /tmp /tmp");
    expect(w.args.filter((a) => a === "/wt").length).toBe(2); // de-duped → exactly one "--bind /wt /wt"
    const sx = wrapCommand("sandbox-exec", "claude", ["-p"], "/wt", ["/home/u/.claude"]).args[1];
    expect(sx).toContain('(subpath "/wt")');
    expect(sx).toContain('(subpath "/home/u/.claude")');
  });

  it("sandbox-exec denies writes outside the worktree", () => {
    const w = wrapCommand("sandbox-exec", "claude", ["-p"], "/wt");
    expect(w.cli).toBe("sandbox-exec");
    expect(w.args[0]).toBe("-p");
    expect(w.args[1]).toContain('(deny file-write* (subpath "/"))');
    expect(w.args[1]).toContain("/wt");
    expect(w.args.slice(2)).toEqual(["claude", "-p"]);
  });

  it("sandboxUsable: true on a version probe, false on a crash banner (degrade signal)", () => {
    const versionOk = () => ({ ok: true, out: "2.1.183 (Claude Code)\n" });
    const bunCrash = () => ({ ok: true, out: "Bun v1.4.0\npanic(main thread): Segmentation fault\noh no: Bun has crashed." });
    expect(sandboxUsable("bubblewrap", "claude-ok", versionOk)).toBe(true);
    expect(sandboxUsable("bubblewrap", "claude-crash", bunCrash)).toBe(false); // exit 0 but crashed → not usable
    expect(sandboxUsable("none", "claude", versionOk)).toBe(false); // no backend → never usable
  });
});
