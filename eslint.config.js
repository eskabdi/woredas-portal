import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // shadcn/ui primitives, per CLAUDE.md: added via the shadcn CLI, not
    // hand-written. Every CVA-based primitive it generates co-exports a
    // `*Variants` helper (and some export a companion hook, e.g. useFormField,
    // useSidebar) alongside the component -- that's the shape the CLI ships,
    // not something to "fix" by hand without diverging from what a future
    // `shadcn add` would regenerate.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Deliberate shared table-state infrastructure (see CLAUDE.md's "Shared UI
    // conventions"): each file co-locates a component with the URL-state hooks
    // that back it, imported together across most list routes. Splitting hooks
    // into a sibling file would be a real refactor of every call site, not a
    // lint fix.
    files: ["src/components/common/TablePagination.tsx", "src/components/common/TableToolbar.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  eslintPluginPrettier,
);
