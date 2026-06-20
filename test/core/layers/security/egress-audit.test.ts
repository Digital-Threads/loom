import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEgressObserver } from "../../../../src/core/layers/security/egress-audit.js";
import { configureSecurity, type AuditEvent } from "../../../../src/core/layers/security/config.js";

describe("egress observer (dedupe + audit)", () => {
  let captured: AuditEvent[];
  beforeEach(() => { captured = []; configureSecurity({ emit: (_p, e) => captured.push(e) }); });
  afterEach(() => { configureSecurity({ emit: () => {} }); });

  it("audits a host the first time it is seen and dedupes repeat connections", () => {
    const obs = createEgressObserver({ projectId: "p1", taskId: "t1" });
    obs.onHost("api.anthropic.com", 443);
    obs.onHost("api.anthropic.com", 443); // same destination, second connection
    obs.onHost("registry.npmjs.org", 443);

    expect(obs.hosts()).toEqual(["api.anthropic.com:443", "registry.npmjs.org:443"]);
    const egress = captured.filter((e) => e.type === "audit.egress.observed");
    expect(egress.length).toBe(2); // one event per distinct destination, not per connection
    expect(egress[0].message).toContain("api.anthropic.com");
    expect(egress[0].taskId).toBe("t1");
  });
});
