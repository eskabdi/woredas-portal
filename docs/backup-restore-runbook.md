# Backup and restore runbook

**Status:** interim control for **P0-1 / WP-OPS-002** (security audit 2026-09-24).
Production is on the Supabase **Free plan**: no platform backups, no PITR. Until the
owner buys Pro + PITR, this nightly job is the only copy of production data. Keep it
after the upgrade as an off-platform copy, since PITR does not protect against losing
the project or the account.

|                    |                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Job                | `.github/workflows/nightly-backup.yml` (daily 00:17 UTC = 03:17 Addis Ababa = 9:17 ለሊት; also runnable by hand)                                                                                                                 |
| Scripts            | `scripts/backup/backup.sh`, `restore-verify.sh`, `encrypt.sh`, `row-counts.sql`, `managed-schema-extras.sql`                                                                                                                   |
| Kept for           | 30 days, as age-encrypted workflow artifacts                                                                                                                                                                                   |
| **RPO**            | ≤ 24 hours (one nightly snapshot; up to 30 days of history)                                                                                                                                                                    |
| **RTO (estimate)** | ~2 hours to a working replacement project (steps in §5). The data path (decrypt, restore, verify) takes minutes and is re-tested every night. The rest is manual configuration and has **not** been timed in a full drill yet. |

## 1. What a backup contains, and what it does not

**Contains:**

- The database, dumped with `supabase db dump`, which is the format Supabase documents for restoring into a new project:
  - `roles.sql`: custom roles;
  - `schema.sql`: every app schema object;
  - `data.sql`: all rows, including `auth.users`/`auth.identities` (bcrypt password hashes) and `storage.objects`/`storage.buckets`.
- `managed-extras.sql`: the app's own objects inside the `auth` and `storage` schemas, which the CLI dump skips.
  - Today this is the **38 `storage.objects` RLS policies** that enforce woreda isolation on files.
  - Without this file a restore would bring back every file with no woreda isolation at all, and nothing would error.
- Every Storage object, copied bucket by bucket over the Storage S3 protocol, when the S3 secrets are set.
- Row counts per table (taken before and after the dump), schema-object counts (policies, triggers, functions, views, RLS-enabled tables), and a `MANIFEST` of SHA-256 sums.
- `vault-secret-fingerprints.tsv`: a **SHA-256 fingerprint** of each Vault secret. It is never the value.

**Does not contain, so these must be held separately (§3):**

| Item                                                                                                                                                                   | Why it is not in the backup                                                                           | Consequence if lost                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault secret `pii_root_key`                                                                                                                                            | The CLI skips the `vault` schema, and a new project cannot decrypt another project's Vault ciphertext | Every `encrypt_pii_*` column is **permanently unreadable**                                                                                                                                                                   |
| Edge Function secret `HARARI_EC_PRIVATE_KEY`                                                                                                                           | Function secrets are not in the database                                                              | Printed cards still verify, since the public key is in the repo. But no new card can be signed with the same key: a new key pair would need a frontend release, and old and new keys would have to be accepted side by side. |
| Edge Function secret `SITE_URL`, Auth settings (site URL, redirect allow-list, SMTP, email templates, password policy, CAPTCHA), SSL enforcement, network restrictions | Platform configuration, not data                                                                      | Re-enter them by hand (§5, step 6). Current values are recorded in `docs/audit/2026-09-24/10-live-verification.md`.                                                                                                          |
| Edge Function code, migrations, frontend                                                                                                                               | Already in this repository                                                                            | Redeploy from `main`                                                                                                                                                                                                         |
| Vercel environment variables                                                                                                                                           | Vercel configuration                                                                                  | Re-point them at the new project (§5, step 8)                                                                                                                                                                                |

## 2. Security properties

- **Encryption:**
  - The archive is encrypted with [age](https://age-encryption.org) (X25519 + ChaCha20-Poly1305) to the owner's public key(s).
  - Only public keys are stored in GitHub. The private key never leaves the owner's custody, so neither a leaked artifact nor a compromised workflow can read a backup.
  - `encrypt.sh` refuses to run without a valid recipient. There is no plaintext fallback.
- **This repository is public.**
  - Workflow logs and job summaries are world-readable, and artifacts can be downloaded by any signed-in GitHub user.
  - Only the ciphertext leaves the runner. The public summary shows table names, PASS/FAIL and schema-object counts, which can be worked out from the public migrations anyway.
  - Row counts, and psql error text (which can quote a row, e.g. a duplicate key's value), are written only into `restore-report.md` and `restore-errors.log` inside the encrypted archive.
- **Secrets are scoped to the `backup` GitHub environment.**
  - Restrict that environment's deployment branches to `main` (§3, step 5), so a workflow edited on another branch cannot read them.
  - The database URL grants the `postgres` role, and the S3 key pair grants full Storage access. Treat both like the service role key.
- **Transport:**
  - The database connection uses `sslmode=require`, and SSL enforcement is on server-side (QW-1).
  - Storage uses HTTPS.
  - `sslmode=require` encrypts the connection but does not verify the server's certificate. Moving to `verify-full` with Supabase's CA certificate is a later hardening step.
- **The restore guard:** `restore-verify.sh` refuses any `*.supabase.co`/`*.supabase.com` URL unless `ALLOW_REMOTE_RESTORE=yes` is set. Set it only for a **new, empty** project. Never point it at production.
- **Data residency (WP-OPS-011, owner decision):**
  - GitHub stores the encrypted artifacts outside Ethiopia and the EU.
  - The contents are unreadable without the private key, but the owner should record that this is accepted, or move the archive to a store in an approved location.

## 3. One-time setup (owner)

Do these on your own machine or in the dashboards. Nothing here goes through Claude or into the repository.

1. **Create the backup key pair** on a trusted machine, with age installed:
   ```bash
   age-keygen -o woredas-backup-key.txt     # prints: Public key: age1...
   ```
   - Keep `woredas-backup-key.txt` offline in **two** places, for example a password manager entry and an encrypted USB drive in a safe.
   - Never upload it or commit it.
   - For a second custodian, have them generate their own pair and list both public keys (step 5).
2. **Keep `pii_root_key` offline** (one time; the key does not change):
   - In the Supabase SQL editor, run `select decrypted_secret from vault.decrypted_secrets where name = 'pii_root_key';`
   - Store the value next to the backup key, as a separate entry.
   - Do the same for `HARARI_EC_PRIVATE_KEY`, from wherever it was generated. Supabase's secrets page shows only a hash of it.
3. **Database connection string:**
   - Reset the database password (Project Settings → Database). This also closes the "rotate the DB password" item in QW-1.
   - Copy the **Session pooler** connection string (Connect → Session pooler; port 5432, IPv4) and append `?sslmode=require`.
   - Do not use the direct `db.<ref>.supabase.co` host: GitHub runners have no IPv6 route to it.
4. **Storage S3 keys:**
   - Go to Storage → S3 Configuration: enable the connection and create an access key.
   - Note the endpoint, `https://tugzuexfyzbdnghbmrjl.storage.supabase.co/storage/v1/s3`.
   - If your plan doesn't offer S3 access, skip this step. The job then backs up the database only, and every run says so.
5. **GitHub → Settings → Environments → New environment `backup`:**
   - Deployment branches: **Selected branches → `main`**.
   - Secrets:
     - `SUPABASE_DB_URL`: the string from step 3;
     - `SUPABASE_S3_ACCESS_KEY_ID` and `SUPABASE_S3_SECRET_ACCESS_KEY`: from step 4.
   - Variables:
     - `BACKUP_AGE_RECIPIENTS`: the `age1...` public key(s), space-separated;
     - `SUPABASE_S3_ENDPOINT`: from step 4;
     - `SUPABASE_S3_REGION`: `eu-west-1`.
6. **First run:** Actions → _Nightly backup_ → **Run workflow**. Then:
   - Check that the job summary reads **Result: PASS**.
   - Download the artifact and do the §4 check once.
   - Confirm your stored `pii_root_key` matches the fingerprint:
     ```bash
     printf '%s' '<the key value>' | sha256sum   # must equal the pii_root_key line in db/vault-secret-fingerprints.tsv
     ```

## 4. Checking a backup by hand

```bash
sha256sum -c woredas-backup-*.tar.gz.age.sha256
mkdir restore && age -d -i woredas-backup-key.txt woredas-backup-*.tar.gz.age | tar -xzf - -C restore
(cd restore && sed -n '/^$/,$p' MANIFEST | tail -n +2 | sha256sum -c --quiet && echo "manifest OK")
cat restore/restore-report.md          # the nightly restore test's full result, with row counts
```

## 5. Disaster restore into a new project

1. **Create a new Supabase project** in the same region (`eu-west-1`), and set its database password.
2. **Decrypt** the latest good backup (§4).
3. **Restore and verify** (roles, then schema, then auth/storage policies, then data, all in one transaction):
   ```bash
   RESTORE_DB_URL='<new project session-pooler URL>?sslmode=require' ALLOW_REMOTE_RESTORE=yes \
     scripts/backup/restore-verify.sh restore/
   ```
   The result must be **PASS**, the same check the nightly job runs.
4. **Re-create the PII key** from your offline copy. Then confirm the fingerprint and check `pii_encryption_status()`:
   ```sql
   select vault.create_secret('<pii_root_key value>', 'pii_root_key');
   select encode(extensions.digest(decrypted_secret, 'sha256'), 'hex')
     from vault.decrypted_secrets where name = 'pii_root_key';   -- must match vault-secret-fingerprints.tsv
   select public.pii_encryption_status();
   ```
5. **Upload the Storage files** with the new project's S3 key. Use `cp --recursive`, **not `sync`**: the restored `storage.objects` rows make every file look present already, so `sync` silently uploads nothing (tested 2026-09-26).
   ```bash
   for b in restore/storage/objects/*/; do
     aws --endpoint-url https://<new-ref>.storage.supabase.co/storage/v1/s3 \
       s3 cp --recursive "$b" "s3://$(basename "$b")"
   done
   ```
6. **Configuration** (dashboard):
   - Auth: site URL, redirect allow-list (`CLAUDE.md`, "Auth redirect URLs"), SMTP, email templates, password minimum 8 with character classes, CAPTCHA.
   - Database: SSL enforcement, network restrictions.
7. **Edge Functions:**
   - Set the secrets `HARARI_EC_PRIVATE_KEY` (from your offline copy) and `SITE_URL`.
   - Deploy the functions: `scripts/deploy-functions.sh <new-ref>`.
8. **Frontend:**
   - Point the Vercel env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY` (and their non-`VITE_` twins) at the new project, then redeploy.
   - Printed cards keep working: their QR codes point at the Vercel site and carry a token that the restored data resolves.
9. **Smoke test:**
   - A staff login.
   - `/v/<token>` for a known card shows the right status.
   - A resident photo loads.
   - A woreda user sees only their own woreda's rows and files.
10. **Rotate** the old project's keys if it still exists, and record the incident.

## 6. Operating it

- **Failures:**
  - GitHub emails the workflow's owner when a scheduled run fails.
  - A **restore-test failure still keeps the backup**: the job saves the archive, then fails. Read `restore-report.md` and `restore-errors.log` in that run's archive.
- **CLI version drift:**
  - The restore test uses the auth and storage service versions pinned by the Supabase CLI version in the workflow (`supabase@2.118.0`).
  - If production's `auth`/`storage` tables gain columns that version doesn't know, the restore test fails with a "column does not exist" error. Bump the pinned version in the workflow and in `backup.sh` together.
- **Public-repo inactivity:** GitHub disables scheduled workflows after 60 days with no repository activity. A commit or a manual run re-enables it.
- **Rotation:** rotate `SUPABASE_DB_URL` (database password) and the S3 key pair when a person with access leaves. Replace `BACKUP_AGE_RECIPIENTS` when a custodian changes; old archives stay readable only with the old private key.

## 7. How this was tested (2026-09-26)

All of this was run against a local `supabase start` stack using the Postgres image production runs (`17.6.1.155`), loaded with all 93 repository migrations, `seed.sql`, one sign-in user and one Storage object:

- **Backup → encrypt → wipe → fresh stack → decrypt → restore → verify: PASS.**
  - 101 tables compared.
  - Schema objects match the source: 154 public and 38 storage policies (the same as production), 139 triggers, 153 functions, 17 views, 66 RLS-enabled tables.
  - The restored user signed in with their original password.
- **Tamper tests:**
  - One row removed from `public.woreda` plus one Storage policy removed: **FAIL**, naming both.
  - A duplicated row: the restore aborts, and the public output shows only the file and line; the key value stays in the encrypted log.
- **Encryption:**
  - `encrypt.sh` refuses to run with no recipient or a malformed one.
  - The ciphertext contains no plaintext marker.
- **Storage re-upload:** `s3 cp --recursive` restores a file that serves correctly afterwards; `s3 sync` skips it.
- **Production read access** (checked 2026-09-26): the production `postgres` role can read everything the backup needs (`vault.decrypted_secrets` for the fingerprint, `extensions.digest`, `storage.objects`).
- **Not yet done:** the first run against production, which needs §3, and a timed full drill of §5.
