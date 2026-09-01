import path from "node:path";
import { defineConfig } from "vitest/config";
import viteReact from "@vitejs/plugin-react";

// Deliberately not vite.config.ts: the app config's tanstackStart/nitro
// plugins target a server build and don't need to run for component tests.
// The "@/*" alias is redeclared here (rather than reused via tsconfigPaths)
// to keep this config's only dependency the path itself.
export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
