// secureExecutor (L10.5) — wraps a StepExecutor so every run is bounded by a
// process limit, its captured output is scanned for secrets (audited) and
// redacted before it leaves the sandbox. The worktree cwd is prepared upstream
// (orchestrate runSpec); this decorator adds the redact/audit/limit layer.
import type { StepExecutor, ExecRequest, ExecResult } from "../automation/exec-loop.js";
import { scanSecrets, redactSecrets } from "./secrets.js";
import { audit } from "./audit.js";
import { runWithLimits, type ProcLimits } from "./sandbox-backend.js";

export interface SecureExecutorOptions {
  limits?: ProcLimits;
  /** Audit secret findings to the bus (default true). */
  auditSecrets?: boolean;
}

export function secureExecutor(inner: StepExecutor, opts: SecureExecutorOptions = {}): StepExecutor {
  const auditOn = opts.auditSecrets !== false;
  return {
    async run(req: ExecRequest): Promise<ExecResult> {
      let res: ExecResult;
      try {
        res = await runWithLimits(() => inner.run(req), opts.limits ?? {});
      } catch (e) {
        return { exitCode: 1, stderr: redactSecrets((e as Error).message) };
      }
      const projectId = req.ids.projectId;
      if (auditOn) {
        for (const out of [res.stdout, res.stderr]) {
          if (!out) continue;
          for (const f of scanSecrets(out)) {
            audit({
              projectId,
              taskId: req.ids.taskId,
              workflowId: req.ids.workflowId,
              kind: "secret.found",
              message: `${f.kind} ${f.preview}`,
            });
          }
        }
      }
      return {
        ...res,
        stdout: res.stdout ? redactSecrets(res.stdout) : res.stdout,
        stderr: res.stderr ? redactSecrets(res.stderr) : res.stderr,
      };
    },
  };
}
