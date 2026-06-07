import type { InstallRecipe } from "../install/types.js";
import type { LoomCategory } from "@digital-threads/loom-contract";

export type CatalogStatus = "installed" | "not-installed" | "update-available";

export interface CatalogEntry {
  id: string;
  title: string;
  case: string;
}

export interface ResolvedEntry extends CatalogEntry {
  category: LoomCategory;
  recipe: InstallRecipe;
}

export interface CatalogItem extends ResolvedEntry {
  status: CatalogStatus;
  installedVersion?: string;
  latestVersion?: string;
  enabled?: boolean;
}
