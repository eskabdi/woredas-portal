# Conventions to get right in the manual

These are details `CLAUDE.md` documents about the app itself that a manual
author needs to know to describe the app correctly — not rendering mechanics.

## The admin console is English, on purpose

`admin.*` routes (super-admin console: tenant provisioning, user management,
credential template design) are English-language in the app itself — this
isn't an oversight to "fix" in the manual. Write the admin chapter's prose in
Amharic (the manual's own language), but keep UI labels, button text, and
field names you quote from that portal in English, matching what a super
admin actually sees on screen. Mixing this up (Amharicizing a label the app
never translated) makes a screenshot placeholder's description mismatch the
real screenshot once someone fills it in.

## Dates are Ethiopian-calendar in the woreda portal

Every date the woreda portal displays goes through Ethiopian-calendar
conversion (`src/utils/ethiopianCalendar.ts`) — Gregorian is what's stored,
Ethiopian is what's shown. When describing a date field or a date picker in
the manual, say so and show an Ethiopian-format example date, not a
Gregorian one — a reader who sees a manual with the wrong calendar in a
screenshot description will assume the manual is for a different version of
the app.

## Storage paths and the one bare-path exception

Uploaded files (resident photos, scanned documents, tenant logos) live under
a `${woredaId}/...` path prefix — this is invisible to the end user, so it
almost never needs to appear in the manual. The one exception: if a section
ever documents the super-admin credential template editor, note that its
uploads are the deliberate exception (a platform-level bare path, not a
tenant one) if you're explaining *why* an admin screen behaves differently
from every woreda-facing upload — otherwise leave storage internals out of a
user-facing manual entirely.

## Module gating means "off" needs an explicit reason

`tenant_module_config` can disable whole modules (revenue, civil
registration, etc.) per woreda. If the manual documents a module some woredas
might not have enabled, say so plainly ("ይህ ክፍል በሁሉም ወረዳዎች ላይኖር ይችላል" / "this
section may not be available in every woreda") rather than presenting every
module as universally present — a reader in a woreda without Revenue enabled
shouldn't think their app is broken when they can't find the module.

## Permissions mean not every reader sees every screen

The manual is written for the full role set (`tenant_admin`,
`civil_registrar`, `registry_clerk`, `finance_clerk`, `supervisor`,
`auditor`, `viewer`), not one persona. When a screen or action is
role-restricted, name the roles that can see it (check the route's
`<PermissionGate permission={P.X}>` and cross-reference
`src/config/permissions.ts`) rather than writing every section as if every
reader has full access — a viewer-role reader following steps meant for a
finance clerk will hit a wall the manual didn't warn them about.
