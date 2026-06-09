// Shim: the contract types moved to contract.ts (the plugin contract) (Phase 9.1).
// `export type *` is fully erased at runtime; existing loom-host imports
// (`../plugins/types.js`) keep working without changes.
export type * from "./contract.js";
