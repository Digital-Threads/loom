// On the PR stage, syncing the task worktree onto the live remote base can hit a
// rebase conflict. Loom's value is that the AGENT does the work, not the human in
// a terminal — so a conflict is handed to an agent pass to resolve, exactly like
// any other coding task. The host only re-enters the rebase and verifies the
// outcome; the human is a last-resort fallback when the agent can't finish.

export interface RebaseResolveDeps {
  /** Run a git command in `cwd`; returns exit code + stdout. */
  git: (args: string[], cwd: string) => Promise<{ code: number; stdout: string }>;
  /** Run ONE agent resolution pass in the worktree. The agent edits the
   *  conflicted files, `git add`s them, runs `git rebase --continue` until the
   *  rebase finishes, and verifies the tests. Returns the agent's reply. */
  agent: (prompt: string) => Promise<string>;
}

/** The instruction handed to the resolution agent. */
export function rebaseResolvePrompt(base: string): string {
  return [
    `A git rebase onto ${base} is in progress in this worktree and has stopped on conflicts.`,
    "Resolve EVERY conflict, preserving this task's intended changes while keeping the updates from",
    `${base}. Then \`git add\` the resolved files and \`git rebase --continue\` — repeat until the`,
    "rebase finishes. Finally run the repo's tests and make sure they pass. Do NOT abort the rebase.",
  ].join(" ");
}

/** Let the agent resolve a rebase conflict instead of parking for a human.
 *  Re-enters the rebase onto `base`, runs one agent pass, then confirms the
 *  rebase actually completed: the tree is clean AND `base` is now an ancestor of
 *  HEAD. On failure the rebase is aborted so the caller falls back to a clean
 *  tree (and the human). */
export async function resolveRebaseWithAgent(
  cwd: string,
  base: string,
  deps: RebaseResolveDeps,
): Promise<{ resolved: boolean }> {
  await deps.git(["rebase", base], cwd); // re-enter the conflicted rebase for the agent
  await deps.agent(rebaseResolvePrompt(base));
  const clean = !(await deps.git(["status", "--porcelain"], cwd)).stdout.trim();
  const onBase = (await deps.git(["merge-base", "--is-ancestor", base, "HEAD"], cwd)).code === 0;
  if (clean && onBase) return { resolved: true };
  await deps.git(["rebase", "--abort"], cwd); // best-effort: leave a clean tree for the fallback
  return { resolved: false };
}
