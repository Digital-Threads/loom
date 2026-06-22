// Egress allowlist matching (Phase 2 of loom-xclx). A host passes if it matches
// an allowlist entry exactly, or matches a `*.domain` wildcard as a subdomain
// (api.anthropic.com vs *.anthropic.com). Matching is case-insensitive and the
// wildcard only matches a real subdomain — it never matches the bare apex, and a
// "github.com.attacker.net" suffix trick can't sneak past it.

/** The hosts a coding agent legitimately reaches: the model API, package
 *  registries, and git hosts. The operator extends this from Phase 1's observed
 *  egress; off-list hosts are refused when enforcement is on. */
export const DEFAULT_EGRESS_ALLOW: string[] = [
  "api.anthropic.com", "*.anthropic.com",
  "registry.npmjs.org", "*.npmjs.org",
  "github.com", "*.github.com", "*.githubusercontent.com",
  "pypi.org", "*.pypi.org", "files.pythonhosted.org",
];

export function allowsHost(host: string, allowlist: string[]): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  return allowlist.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1); // ".anthropic.com"
      return h.length > suffix.length && h.endsWith(suffix); // a real subdomain, not the apex
    }
    return h === p;
  });
}
