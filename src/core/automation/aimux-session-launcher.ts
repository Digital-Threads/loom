// Real SessionLauncher: maps TaskSession.send → one aimux headless turn that
// creates (--session-id) or resumes (--resume) the task's Claude session. The
// session flags ride through aimux's extraArgs passthrough, so aimux itself is
// untouched (additive — the iron back-compat rule). With no config/profile it
// degrades to empty output (same graceful fallback as the dialog agent).

import { loadConfig, runProfileHeadless } from "@digital-threads/aimux/core";
import { listSubscriptions } from "../plugins/aimux/adapter.js";
import type { SessionLauncher } from "./task-session.js";

export interface AimuxSessionLauncherDeps {
  launch?: typeof runProfileHeadless;
  loadConfig?: typeof loadConfig;
  profile?: string;
  model?: string;
}

export function createAimuxSessionLauncher(deps: AimuxSessionLauncherDeps = {}): SessionLauncher {
  const launch = deps.launch ?? runProfileHeadless;
  const load = deps.loadConfig ?? loadConfig;
  return {
    run: async (prompt, opts) => {
      const cfg = load();
      if (!cfg) return { text: "" };
      const profile = deps.profile ?? listSubscriptions()[0]?.name;
      if (!profile) return { text: "" };
      // resume an existing session, or create it with our chosen id.
      const sessionArgs = opts.resume ? ["--resume", opts.sessionId] : ["--session-id", opts.sessionId];
      const res = await launch(cfg, profile, {
        model: deps.model,
        cwd: opts.cwd,
        extraArgs: ["-p", prompt, ...sessionArgs],
      });
      return { text: res.stdout ?? "" };
    },
  };
}
