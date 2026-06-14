// L11.1 — plugin integrity at install/load: verify a plugin dir against its
// witness; on mismatch, warn + audit (soft) rather than blocking (agreed with
// security v1). Hard-block belongs to enforce mode before autopilot.
import { verifyWitness, type Witness, type VerifyResult } from "./verify.js";
import { audit } from "../security/audit.js";

export interface VerifyPluginOptions {
  /** Project for the audit event; omit to skip auditing. */
  projectId?: string;
}

export function verifyPlugin(
  name: string,
  dir: string,
  witness: Witness,
  opts: VerifyPluginOptions = {},
): VerifyResult {
  const res = verifyWitness(dir, witness);
  if (!res.ok && opts.projectId) {
    audit({
      projectId: opts.projectId,
      kind: "plugin.verify",
      message: `plugin "${name}" witness mismatch — drifted ${res.drifted.length}, missing ${res.missing.length}`,
      metrics: { drifted: res.drifted.length, missing: res.missing.length },
    });
  }
  return res;
}
