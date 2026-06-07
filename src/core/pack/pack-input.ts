import type { WorkspaceData } from "../data/loader.js";

// Узкий контракт того, что LP9 берёт из workspace-config (LP8).
export interface WorkspaceConfigSlice {
  projectName?: string;
  activeProfile?: string;
  activeTaskId?: string;
}

export interface PackInput {
  data: WorkspaceData;
  config: WorkspaceConfigSlice;
}
