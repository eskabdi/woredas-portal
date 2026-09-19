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
  environments: {
    // Scoped to the browser build only -- see the comment below on why this
    // can't stay in the shared top-level `build` config once the ssr/nitro
    // environments need `inlineDynamicImports`, which rolldown refuses to
    // combine with `manualChunks` on the same environment.
    client: {
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
    },
    // This Vite 8/rolldown/nitro beta combination has a real bug where
    // src/router.tsx (createRouter + the generated route tree) gets split
    // into two mutually-circular chunks whose load order isn't guaranteed:
    // whichever chunk a given request path imports first can end up calling
    // the other's rolldown-generated __exportAll helper before that chunk
    // has finished initializing it, throwing "TypeError: __exportAll is not
    // a function" at request time in Node's real ESM loader. Reproduced
    // locally by importing the two chunks directly in each order; local
    // `bun run build`/dev never exercises cross-chunk ESM load order the
    // way a live request does, so this only surfaced once this branch was
    // actually deployed.
    //
    // Forcing router.tsx into a single named chunk removes the chunk
    // boundary that circular reference needs, without disabling
    // code-splitting for the rest of the ssr bundle -- an earlier attempt at
    // `inlineDynamicImports: true` "fixed" this but ate the lazy-loading
    // that keeps browser-only libraries (pdfjs-dist, in particular, which
    // references `DOMMatrix` and only worked because it was never eagerly
    // imported into the request path) out of every request's synchronous
    // import graph, turning every route 500 with `DOMMatrix is not
    // defined`. That's strictly worse, so this stays scoped to the one
    // module that's actually circular.
    ssr: {
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes("/src/router.tsx")) return "app-router";
            },
          },
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
