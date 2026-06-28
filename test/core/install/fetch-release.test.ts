import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import {
  releaseTarget, assetFileName, releaseAssetUrl, parseChecksums, fetchRelease,
  type CmdRun, type FetchReleaseSpec,
} from "../../../src/core/install/fetch-release.js";

describe("releaseTarget", () => {
  it("maps the supported platform/arch pairs to target + ext", () => {
    expect(releaseTarget("linux", "x64")).toEqual({ target: "x86_64-unknown-linux-gnu", ext: "tar.gz" });
    expect(releaseTarget("darwin", "arm64")).toEqual({ target: "aarch64-apple-darwin", ext: "tar.gz" });
    expect(releaseTarget("darwin", "x64")).toEqual({ target: "x86_64-apple-darwin", ext: "tar.gz" });
    expect(releaseTarget("win32", "x64")).toEqual({ target: "x86_64-pc-windows-msvc", ext: "zip" });
  });
  it("returns null for an unsupported pair", () => {
    expect(releaseTarget("linux", "arm64")).toBeNull();
    expect(releaseTarget("freebsd" as NodeJS.Platform, "x64")).toBeNull();
  });
});

describe("assetFileName / releaseAssetUrl", () => {
  it("builds the asset name and download URL", () => {
    const file = assetFileName("task-journal", "v0.28.3", "x86_64-unknown-linux-gnu", "tar.gz");
    expect(file).toBe("task-journal-v0.28.3-x86_64-unknown-linux-gnu.tar.gz");
    expect(releaseAssetUrl("Digital-Threads/Task-Journal", "v0.28.3", file))
      .toBe("https://github.com/Digital-Threads/Task-Journal/releases/download/v0.28.3/task-journal-v0.28.3-x86_64-unknown-linux-gnu.tar.gz");
  });
});

describe("parseChecksums", () => {
  it("parses `<sha>  <file>` lines, tolerates blanks and a binary `*` marker", () => {
    const txt = "abc\n" + // junk line (no 64-hex) ignored
      "0".repeat(64) + "  a.tar.gz\n" +
      "\n" +
      "1".repeat(64) + " *b.zip\n";
    const m = parseChecksums(txt);
    expect(m["a.tar.gz"]).toBe("0".repeat(64));
    expect(m["b.zip"]).toBe("1".repeat(64));
    expect(Object.keys(m).length).toBe(2);
  });
});

describe("fetchRelease (orchestration, mocked curl/tar)", () => {
  let tmp: string, dest: string;
  const spec: FetchReleaseSpec = { repo: "Digital-Threads/Task-Journal", tag: "v0.28.3", name: "task-journal", bins: ["task-journal", "task-journal-mcp"] };
  const archiveBody = "FAKE-ARCHIVE-BYTES";

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "fr-tmp-")); dest = mkdtempSync(join(tmpdir(), "fr-dst-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); });

  // Mock curl (writes the archive / a matching checksums.txt) + tar (drops the bins).
  const mockRun = (opts: { goodChecksum?: boolean; tarOk?: boolean; dropBins?: string[] }): CmdRun =>
    (cmd, args) => {
      if (cmd === "curl") {
        const out = args[args.indexOf("-o") + 1];
        if (out.endsWith("checksums.txt")) {
          const sha = (opts.goodChecksum ?? true)
            ? createHash("sha256").update(archiveBody).digest("hex")
            : "f".repeat(64);
          // the archive's basename must match the checksums entry
          const file = assetFileName(spec.name, spec.tag, "x86_64-unknown-linux-gnu", "tar.gz");
          writeFileSync(out, `${sha}  ${file}\n`);
        } else {
          writeFileSync(out, archiveBody);
        }
        return { ok: true, stdout: "", stderr: "" };
      }
      if (cmd === "tar") {
        if (opts.tarOk === false) return { ok: false, stdout: "", stderr: "bad archive" };
        const d = args[args.indexOf("-C") + 1];
        for (const b of (opts.dropBins ?? spec.bins)) writeFileSync(join(d, b), "#!/bin/sh\n");
        return { ok: true, stdout: "", stderr: "" };
      }
      return { ok: false, stdout: "", stderr: `unexpected ${cmd}` };
    };

  it("downloads, verifies the checksum, extracts, and makes the binaries executable", () => {
    const r = fetchRelease(spec, { platform: "linux", arch: "x64", dest, tmp, run: mockRun({}) });
    expect(r.ok).toBe(true);
    for (const b of spec.bins) {
      const p = join(dest, b);
      expect(existsSync(p)).toBe(true);
      expect(statSync(p).mode & 0o111).toBeTruthy(); // executable bit set
    }
  });

  it("fails on a checksum mismatch (no extract)", () => {
    const r = fetchRelease(spec, { platform: "linux", arch: "x64", dest, tmp, run: mockRun({ goodChecksum: false }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/checksum mismatch/);
    expect(existsSync(join(dest, "task-journal"))).toBe(false);
  });

  it("fails when a declared binary is missing from the archive", () => {
    const r = fetchRelease(spec, { platform: "linux", arch: "x64", dest, tmp, run: mockRun({ dropBins: ["task-journal"] }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/task-journal-mcp missing/);
  });

  it("fails fast (no network) on an unsupported platform", () => {
    let called = false;
    const r = fetchRelease(spec, { platform: "linux", arch: "arm64", dest, tmp, run: () => { called = true; return { ok: true, stdout: "", stderr: "" }; } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no prebuilt binary/);
    expect(called).toBe(false);
  });
});
