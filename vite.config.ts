import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  css: {
    transformer: "lightningcss",
  },
  resolve: {
    // Resolves "@/*" from the paths mapping in tsconfig.json, so that file
    // stays the single source of truth for path aliases.
    tsconfigPaths: true,
    // React and TanStack Query must resolve to a single copy, or hooks break.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  // Plugin order matters: Tailwind runs before TanStack Start, and the React
  // plugin runs last.
  plugins: [
    tailwindcss(),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      // nitro/vite builds from this.
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    // Deploy plugin is build-only. No preset is pinned, so nitro builds its
    // portable Node server output; set NITRO_PRESET or SERVER_PRESET to
    // target a specific host.
    ...(command === "build" ? [nitro()] : []),
    viteReact(),
  ],
}));
