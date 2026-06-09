import type { WorkspaceData } from "../data/loader.js";

// Narrow contract for what LP9 takes from the workspace config (LP8).
export interface WorkspaceConfigSlice {
  projectName?: string;
  activeProfile?: string;
  activeTaskId?: string;
}

export interface PackInput {
  data: WorkspaceData;
  config: WorkspaceConfigSlice;
}
