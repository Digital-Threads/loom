import { defineConfig } from "vitest/config";
// testTimeout 30s: a few tests invoke live external CLIs (aimux/health) that can
// exceed the 5s default on a cold machine — see loom-djt.
export default defineConfig({ test: { environment: "node", testTimeout: 30_000 } });
