import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Deliberately separate from vite.config.ts: that config wires in TanStack
// Start's SSR plugin and nitro, neither of which a unit test needs or can
// run under (nitro is build-only). Unit tests only need React + the same
// "@/*" path alias tsconfig.json defines, via Vite's built-in tsconfig-paths
// resolution (`resolve.tsconfigPaths`, same as vite.config.ts uses).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
  },
});
