import { describe, it, expect } from "vitest";
import { liveCandidates } from "../../../src/core/automation/router-live.js";
import { chooseRoute } from "../../../src/core/automation/router.js";

describe("liveCandidates (L4.6)", () => {
  it("maps subscriptions to candidates (profile = name)", () => {
    const c = liveCandidates({ subscriptions: [{ name: "work" }, { name: "main" }], health: [] });
    expect(c).toEqual([{ profile: "work" }, { profile: "main" }]);
  });

  it("excludes profiles whose health is explicitly failing", () => {
    const c = liveCandidates({
      subscriptions: [{ name: "work" }, { name: "dead" }],
      health: [{ profile: "dead", ok: false }],
    });
    expect(c.map((x) => x.profile)).toEqual(["work"]);
  });

  it("feeds chooseRoute — picks an eligible live profile", () => {
    const pool = liveCandidates({ subscriptions: [{ name: "work" }], health: [] });
    expect(chooseRoute({}, pool)).toEqual({ profile: "work", model: undefined });
  });
});
