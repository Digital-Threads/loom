import { describe, it, expect } from "vitest";
import { allowsHost, DEFAULT_EGRESS_ALLOW } from "../../../../src/core/layers/security/egress-allowlist.js";

describe("allowsHost", () => {
  it("matches exact hosts and wildcard subdomains, case-insensitively", () => {
    expect(allowsHost("github.com", ["github.com"])).toBe(true);
    expect(allowsHost("api.anthropic.com", ["*.anthropic.com"])).toBe(true);
    expect(allowsHost("codeload.github.com", ["*.github.com"])).toBe(true);
    expect(allowsHost("API.GitHub.com", ["*.github.com"])).toBe(true); // case-insensitive
    expect(allowsHost("anthropic.com", ["*.anthropic.com"])).toBe(false); // apex isn't a subdomain
    expect(allowsHost("evil.com", ["github.com", "*.anthropic.com"])).toBe(false);
  });

  it("a not-evil suffix trick doesn't sneak past the wildcard", () => {
    // "*.github.com" must NOT match "github.com.attacker.net"
    expect(allowsHost("github.com.attacker.net", ["*.github.com"])).toBe(false);
  });

  it("the default allowlist covers the agent's core hosts but not arbitrary ones", () => {
    for (const h of ["api.anthropic.com", "registry.npmjs.org", "github.com", "codeload.github.com"]) {
      expect(allowsHost(h, DEFAULT_EGRESS_ALLOW)).toBe(true);
    }
    expect(allowsHost("exfil.attacker.net", DEFAULT_EGRESS_ALLOW)).toBe(false);
  });
});
