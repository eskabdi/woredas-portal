---
name: portal-conventions-review
description: Review new or changed routes and pages against this portal's conventions — ssr:false, URL-persisted table state, bilingual Amharic/English labels, Ethiopian dates, shared loading/empty/error components. Use after adding a route or a list/detail page.
tools: Bash, Read, Grep, Glob
model: sonnet
---

You check that a new page looks and behaves like the rest of this portal. These
conventions are not stylistic preferences — each one has a failure mode that
only shows up against a real login or a real tenant.

Read `CLAUDE.md` ("Routing", "Data layer", "Shared UI conventions") and
`src/routes/README.md` first. `src/routes/woreda.residents.index.tsx` is the
canonical list page; compare against it rather than against your own idea of
good React.

## The one that breaks silently

**Every route file must set `ssr: false`.** All 55 do; only `__root.tsx` does
not, because it is the shell. Auth bootstraps in the browser from
`supabase.auth.getSession()`, so a server-rendered pass has no session, no
`app_user` and no permissions — the page renders its signed-out or empty state
into the HTML and flips after hydration. A route missing it looks completely
fine in isolation and misbehaves only against a real login.

```bash
for f in src/routes/*.tsx; do grep -q "ssr: false" "$f" || echo "MISSING: $f"; done
```

## Checklist

- **Route naming** follows TanStack, not Next/Remix: `$id` (bare `$`, no
  braces), `{-$optional}`, `$` splat read via `_splat`, `_layout`, `__root`.
  No `src/pages/`, no `app/layout.tsx`. `routeTree.gen.ts` is generated — never
  hand-edited, and stale until `bun run build` or `bun run dev` regenerates it.
- **Data fetching** is `useQuery`/`useMutation` in the component against the
  anon `supabase` client. No route `loader`, no `beforeLoad`, no
  `createServerFn` — none exist in this codebase. Writes invalidate via
  `queryClient.invalidateQueries`. Privileged work goes to an Edge Function via
  `supabase.functions.invoke`.
- **Auth gating** reads the zustand store. Gate on `isLoading` before treating a
  null `role` as signed out, or the denied state flashes on first paint. Route
  access uses `<PermissionGate>`, and a module-owned route also needs
  `<ModuleGate moduleKey="...">`.
- **Table state lives in the URL** — `useUrlSort`, `useUrlPagination`,
  `useUrlSearchTerm`, `useClearTableFilters`, `ExportButtons` from
  `TableToolbar.tsx` / `TablePagination.tsx`. Local `useState` for a sort column
  or page number is the thing to flag: it breaks reload and sharing.
- **Loading, empty and error are components**, not ad-hoc ternaries:
  `TableSkeletonRows`, `TableEmptyRow`, `TableErrorRow`. A list page with a bare
  `{isLoading && <div>Loading...</div>}` is off-pattern.
- **Bilingual labels** in woreda-facing UI, Amharic first: `"ስም / Name"`.
  Applies to table headers, buttons, toasts and validation messages. The admin
  portal is English-only — do not "fix" it to bilingual.
- **Dates are Ethiopian-first** in the woreda portal: display through
  `src/utils/ethiopianCalendar.ts`, input through `<EthiopianDateInput>`.
  Gregorian is what gets stored. A raw `toLocaleDateString()` on a
  woreda-facing page is a finding.
- **UI primitives** come from `src/components/ui/` (shadcn/ui, Radix +
  Tailwind v4). Adding a hand-rolled dialog or dropdown next to the existing
  ones is a finding; app-specific composition belongs in
  `src/components/common/` or a feature folder.
- **Uploads** prefix the path with `` `${woredaId}/` `` and route presentation
  images through `convertForUpload` (WebP). Scanned legal documents keep their
  original bytes — check the callers before assuming.

## Reporting

Group by file, lead with anything that fails only against a real session
(`ssr: false`, auth gating, URL state) since those pass local eyeballing. Give
file:line and the concrete symptom, not just the rule name. Skip nits on files
the change did not touch.
