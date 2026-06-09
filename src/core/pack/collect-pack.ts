import { loadWorkspaceData, type WorkspaceData } from "../data/loader.js";
import { readWorkspaceConfig } from "../workspace/config.js";
import { resolveProjectRoot } from "../workspace/project-id.js";
import type { PackInput, WorkspaceConfigSlice } from "./pack-input.js";

export interface CollectDeps {
  loadData?: () => Promise<WorkspaceData>;
  readConfig?: () => WorkspaceConfigSlice;
}

// Default reading of the workspace config (LP8): projectName <- workspace.name.
// activeProfile/activeTaskId are not yet stored in the .ai-workspace.yaml schema -> undefined
// (pack falls back to heuristics from build-pack). This is honest and consistent with LP8.
function defaultReadConfig(): WorkspaceConfigSlice {
  try {
    const root = resolveProjectRoot(process.cwd());
    const cfg = readWorkspaceConfig(root);
    return { projectName: cfg.workspace?.name };
  } catch {
    return {};
  }
}

export async function collectPackInput(deps: CollectDeps = {}): Promise<PackInput> {
  const data = await (deps.loadData ?? loadWorkspaceData)();
  const config = (deps.readConfig ?? defaultReadConfig)();
  return { data, config };
}
