import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        ws: true,
      },
    },
    watch: {
      // Don't watch (or try to transform) Playwright test artifacts and
      // wrangler state -- they churn during test runs and Vite's CSS
      // analysis tries to resolve them, which causes transient 500s.
      ignored: [
        "**/test-results/**",
        "**/playwright-report/**",
        "**/.wrangler/**",
      ],
    },
  },
});
