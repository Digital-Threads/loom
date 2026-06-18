// secureExecutor (L10.5) — wraps a step executor so every run is bounded by a
// process limit, its captured output is scanned for secrets (audited) and
// redacted before it leaves the sandbox. The worktree cwd is prepared upstream;
// this decorator adds the redact/audit/limit layer.
//
// Generic over the request/result shapes so the package needs no host types: it
// only requires the request to carry spine ids and the result to carry stdio.
import { scanSecrets, redactSecrets } from "./secrets.js";
import { audit } from "./audit.js";
import { runWithLimits, type ProcLimits } from "./sandbox-backend.js";

/** Minimal request shape the decorator reads (the host's full ExecRequest is a
 *  structural superset). */
export interface SecureExecRequest {
  ids: { projectId: string; taskId?: string; workflowId?: string };
}
/** Minimal result shape (host's ExecResult is a structural superset). */
export interface SecureExecResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}
export interface StepExecutorLike<Req extends SecureExecRequest, Res extends SecureExecResult> {
  run(req: Req): Promise<Res>;
}

export interface SecureExecutorOptions {
  limits?: ProcLimits;
  /** Audit secret findings to the bus (default true). */
  auditSecrets?: boolean;
}

export function secureExecutor<Req extends SecureExecRequest, Res extends SecureExecResult>(
  inner: StepExecutorLike<Req, Res>,
  opts: SecureExecutorOptions = {},
): StepExecutorLike<Req, Res> {
  const auditOn = opts.auditSecrets !== false;
  return {
    async run(req: Req): Promise<Res> {
      let res: Res;
      try {
        res = await runWithLimits(() => inner.run(req), opts.limits ?? {});
      } catch (e) {
        return { exitCode: 1, stderr: redactSecrets((e as Error).message) } as Res;
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
