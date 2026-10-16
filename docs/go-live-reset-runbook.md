# Go-live reset runbook

Everything in production before go-live is pilot/test data (owner decision,
15 October 2026). On go-live day, after a verified backup, production is reset
to configuration only. This runbook is the procedure; the scripts are in
`scripts/go-live-reset/`.

**Not reversible except by restoring the backup.** Run it once, on go-live
day, after user acceptance testing (UAT), since UAT itself creates test data.

## What is kept and what is removed

| Kept (configuration)                                                                                                                                                                                                                                                                        | Removed (pilot data)                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Woredas, woreda settings, offices, kebeles, fee schedule, service types, module settings, role permissions, workflow rules, console roles, ID card and certificate templates (with drafts), rental and credential policies, the credential-number counter, active unrestricted super admins | Residents, households, credential requests and cards, payments and receipts, service requests, civil events, rental houses, occupancies, rent accounts, charges and payments, attachments, every history and log table, custom roles and per-user overrides, every other staff account, the audit log, the other number counters |

- **Number counters** restart at 1 (receipts, requests, residents, events,
  rent accounts). The **credential-number counter is kept**, so a test card
  that was printed keeps a number no real resident will receive.
- **Audit log**: the pilot's audit trail is kept in the pre-reset backup
  (encrypted). The live table restarts with one `GO_LIVE_RESET` row that
  records the counts of what was removed.
- **Accounts**: only active super admins with no console role (unrestricted)
  remain. Woreda staff are invited fresh after the reset.
- **Files**: resident, request, rental and attachment files are removed.
  Logos, stamps, signatures and template backgrounds stay. Staff photos and
  signatures stay only for the remaining accounts.

Both scripts fail closed: a table or bucket that is not in their lists stops
the run, so something added after these scripts were written is never
removed or kept by accident. Add it to the right list (and get it reviewed)
first.

## Prerequisites

1. **A verified backup.** The nightly backup (`docs/backup-restore-runbook.md`)
   has run successfully on the day, and its restore test passed. Without it,
   stop. This is the same blocker as migration 90.
2. **The review gate** in `CLAUDE.md` has passed on these scripts.
3. UAT is finished and signed off.
4. Announce a short maintenance window; nobody should be using the portal.

## Procedure

```bash
# 1. Dry run: everything rolls back, prints counts only.
scripts/go-live-reset/run.sh
#    Expect: ERROR ... DRYRUN deleted={...} cleared={...} kept_super_admins=N
#    Check the counts look right and N is the number of super admins you expect.

# 2. Apply (asks you to type the project ref).
scripts/go-live-reset/run.sh --apply
#    Expect: no error. A NOTICE line "APPLIED ..." may or may not be shown by
#    the Management API.

# 3. Files (dry run, then apply). Needs the service-role key in the
#    environment, never on the command line or in a file.
SUPABASE_URL=https://tugzuexfyzbdnghbmrjl.supabase.co bun scripts/go-live-reset/purge-storage.ts
SUPABASE_URL=https://tugzuexfyzbdnghbmrjl.supabase.co bun scripts/go-live-reset/purge-storage.ts --apply
```

## Verify

- Row counts: every removed table is 0; `audit_log` has exactly one
  `GO_LIVE_RESET` row; `app_user` and `auth.users` equal the number of kept
  super admins; the kept tables are unchanged.
- `bun run check:fee-catalog` and the deploy skill's `role_permission`
  invariant still pass.
- Sign in as a super admin at `https://eharari.gov.et` and invite the first
  tenant administrator. Do not create test records afterwards; production now
  holds real data only.

## Clean up

Follow "After every migration or deployment" in `CLAUDE.md`: unset the
tokens, remove payload files, unset `SUPABASE_SERVICE_ROLE_KEY`.
