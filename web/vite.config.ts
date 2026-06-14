import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /api to the local Hono server (loom serve). Prod: Tauri/serve
// hosts the built assets next to the API, so same-origin /api works.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4318,
    proxy: { "/api": "http://localhost:4317" },
  },
  build: { outDir: "dist" },
});
