import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The web app is a separate browser package, so all its tests are component
// tests — run them in jsdom with the same React plugin the build uses (React 19
// automatic JSX runtime). Host/node tests live in the loom-host root project.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
  },
});
