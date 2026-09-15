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
  build: {
    rollupOptions: {
      output: {
        // supabase-js (via auth-js) is imported synchronously at the root
        // (useAuthBootstrap runs on every page), so Rollup's default chunking
        // has nowhere to split it out to -- it lands in the main entry chunk
        // alongside every route. That entry chunk includes auth-js's web3 and
        // WebAuthn/passkey code (GoTrueClient wires both up unconditionally
        // in its constructor; neither is reachable through this app's own
        // code, but the class isn't tree-shakeable by method). Forcing it
        // into its own chunk doesn't remove that code -- only a supabase-js
        // release that lazy-loads those features would -- but it does stop
        // it from bloating the one chunk every page blocks on before first
        // paint, and it's a separately cacheable file that changes far less
        // often than app code.
        manualChunks(id) {
          if (id.includes("node_modules/@supabase/")) return "supabase-vendor";
        },
      },
    },
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
