import { describe, it, expect } from "vitest";
import { githubConnector } from "../../../src/core/connectors/github.js";

describe("githubConnector (D5.5)", () => {
  it("maps gh json to drafts (injected run)", () => {
    const c = githubConnector({
      repo: "owner/repo",
      run: () => JSON.stringify([{ number: 1, title: "Fix bug", body: "d" }, { number: 2, noTitle: true }, { number: 3, title: "Feature" }]),
    });
    const drafts = c.import();
    expect(drafts.map((d) => d.title)).toEqual(["Fix bug", "Feature"]);
    expect(drafts[0].description).toBe("d");
  });
  it("returns [] on bad output", () => {
    expect(githubConnector({ repo: "owner/repo", run: () => "not json" }).import()).toEqual([]);
  });
  it("namespaces the issue number as externalId (idempotent import anchor)", () => {
    const c = githubConnector({ repo: "owner/repo", run: () => JSON.stringify([{ number: 7, title: "Fix" }, { title: "NoNumber" }]) });
    const drafts = c.import();
    expect(drafts[0].externalId).toBe("github:owner/repo#7");
    expect(drafts[1].externalId).toBeUndefined();
  });
  it("empty repo imports nothing (never shells out)", () => {
    let called = false;
    const c = githubConnector({ repo: "", run: () => { called = true; return "[]"; } });
    expect(c.import()).toEqual([]);
    expect(called).toBe(false);
  });
  it("normalizes repo (trim + lowercase) so casing/whitespace can't bypass dedup", () => {
    const json = () => JSON.stringify([{ number: 7, title: "Fix" }]);
    const a = githubConnector({ repo: "Owner/Repo", run: json }).import();
    const b = githubConnector({ repo: "  owner/repo  ", run: json }).import();
    expect(a[0].externalId).toBe("github:owner/repo#7");
    expect(b[0].externalId).toBe("github:owner/repo#7");
  });
  it("whitespace-only repo imports nothing (never shells out)", () => {
    let called = false;
    const c = githubConnector({ repo: "   ", run: () => { called = true; return "[]"; } });
    expect(c.import()).toEqual([]);
    expect(called).toBe(false);
  });
});
