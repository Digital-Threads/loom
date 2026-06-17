import { defineConfig, configDefaults } from "vitest/config";
// testTimeout 30s: a few tests invoke live external CLIs (aimux/health) that can
// exceed the 5s default on a cold machine — see loom-djt.
// web/** is its own browser package (jsdom) with its own vitest config — exclude
// it here so the host's node runner doesn't execute component tests sans DOM.
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, "web/**"],
  },
});
