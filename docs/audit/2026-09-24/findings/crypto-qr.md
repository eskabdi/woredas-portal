# Crypto, QR and Verification-Token Audit — woredas-portal (2026-09-24)

**Agent:** audit-crypto-qr (Wave 2)
**Commit:** HEAD `9950f16`
**Scope:** credential signing-key management, the QR payload, signing and verification, revocation, replay and cloning, the credential-number check digit, letter and receipt verification tokens, receipt-numbering concurrency, and the Phase C PII encryption key hierarchy.
**Method:** static review of the latest definition of every function involved (all 90 migrations were checked for `CREATE OR REPLACE` or redefinitions); a build and a client-bundle scan; a full-history key search; and reproducible experiments with a throwaway key. The live database and Edge secrets were not reachable, so anything that depends on live state is marked *Needs-live-verification*.

Raw evidence (all under `docs/audit/2026-09-24/raw/`):
- `crypto-qr-malleability.ts.txt` / `.txt`: signature re-encoding experiment
- `crypto-qr-luhn.py` / `crypto-qr-luhn-vectors.txt`: check-digit vectors
- `crypto-qr-key-and-base64-scan.txt`: key, bundle and `btoa`/`atob` scan

## 1. Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 1 | WP-CRY-001 |
| Medium | 4 | WP-CRY-002, 003, 006, 007 |
| Low | 3 | WP-CRY-004, 005, 008 |
| Info | 1 | WP-CRY-009 |

**No Critical.** The ES256 private key exists only as the `HARARI_EC_PRIVATE_KEY` Edge Function secret. It was not found in:
- the working tree
- any of the 177 commits across all refs
- any database table
- the freshly built client bundle (`.output/public`)

Only the public SPKI key ships, in `credentialCryptoConfig-*.js`. That is expected, and flagging it would be a known false positive.

**The main problem is revocation, not the cryptography.** Signing is sound: the algorithm is pinned on both sides, there is no JWT header, every signed field is read from the database, and a compare-and-swap write means a token can only be stored once. However, the public verifier looks up live status by exact string equality on the whole token. It also treats "the registry has no row" as a green, genuine result. Because a signed token can be re-encoded without the key, anyone can make a revoked card scan green (WP-CRY-001).

## 2. How the credential QR works (as built)

1. **Minting.**
   - `generate_residence_credential_on_payment()` inserts `residence_credential` at `ready_to_print`. It is the sole INSERT path (migration 29 guard).
   - `assign_credential_number()` mints `WW-KK-YY-NNNNNN-C`, where C is a Luhn check digit.
   - Expiry is `CURRENT_DATE + 1 year` (`00000000000070_...:111`).
2. **Signing** (`supabase/functions/sign-credential/index.ts`). The function checks:
   - the caller's JWT
   - `app_user.status = 'active'`
   - that the woreda matches
   - `user_has_perm('credential.print')` with the caller's own JWT
   - that the status is `ready_to_print` and `qr_payload IS NULL`

   It then reads resident, kebele, woreda and household data from the database. It builds a compact JSON payload (`c,i,n,g,b,w,k,h,s,e,p,t`) and signs `base64url(JSON)` with ECDSA P-256/SHA-256. It stores `payload.signature` in `qr_payload` with an `IS NULL` compare-and-swap (`:253-259`), and `qr_payload` is immutable afterwards (`00000000000046_...:45-47`).
3. **QR target.** `${VITE_PUBLIC_SITE_URL}/v/<token>` (`credentialCryptoConfig.ts:44-46`).
4. **Public verification** (`src/routes/v.$token.tsx`):
   - An offline WebCrypto verify runs against the bundled public key.
   - It then calls `verify_credential_token(_token)`. This is a SECURITY DEFINER function. It is rate-limited on the anonymous path at 30/min per IP and fails open. It matches `rc.qr_payload = _token`, collapses the statuses expired, suspended, revoked and replaced to `invalid` for anonymous callers, and logs every attempt to `credential_verification_log`.
5. **Staff scanner** (`HararildScanner.tsx`). Offline verify, then an optional live check by credential number, limited to the caller's own woreda.

Measured size, using a realistic synthetic payload:

| Item | Size |
|---|---|
| JSON payload | 215 bytes |
| Token | 374 characters |
| Full URL | 410 characters |
| Signature | 86 characters (64 bytes) |

This is well inside the brief's ~1.8 KB budget, and the QR is rendered at ECC level L.

## 3. Findings

### WP-CRY-001 (High): the public verifier fails open; a revoked card can be made to show "Verified"

**Evidence**
- The verifier decodes with lenient `atob` (`src/utils/harariCredentialCrypto.ts:100-107`) and verifies with WebCrypto (`:194-206`).
- The registry lookup is an exact token match: `WHERE rc.qr_payload = _token` (`00000000000034_...:245`). A miss returns an empty result (`:253-264`).
- The page's branch logic: `notFound = !registry && !data.registryError` (`v.$token.tsx:179`), `withdrawn = !!registry && ...` (`:215`), a default green banner (`:261-268`), and only a grey note for no-row or error cases (`:271-279`).

**Two ways to re-encode a token without the key**, both reproduced with the repo's own encode and decode code (`raw/crypto-qr-malleability.txt`):
- **Base64url trailing bits.** 64 bytes encode to 86 characters, so the last character carries 4 unused bits. WHATWG forgiving-base64 (`atob`) discards them. **15 alternative last characters** verify.
- **ECDSA malleability.** `(r, n−s)` is also a valid signature, and WebCrypto does not require low-S. It **verifies**.

**What happens.** Either variant passes the offline signature check. The registry lookup then misses, `registry` is null, and the page falls through to **"የተረጋገጠ ትክክለኛ መታወቂያ / Issued by the Harari Regional State"** in green. The same green banner appears whenever the RPC errors: a network failure, rate-limit exhaustion (30/min per source IP, which is easy to reach behind shared mobile CGNAT), or a deleted row. A forged token signed with a leaked key would also land here.

**Fix**
- Look up status by the signed payload segment (`split_part(qr_payload,'.',1)`) or by the verified credential number, not the whole token.
- Reject non-canonical base64url and high-S signatures in the verifier.
- Render green **only** when `registry.status === 'active'` and the card is not expired. "Not found" should be red. A registry error should be amber ("status unknown"), never green.

A secure-fix example is in the JSON.

### WP-CRY-002 (Medium): the staff scanner verifies on the signature alone

`HararildScanner.tsx:297` sets `isVerifiedOk = valid && !expired`. The green "Verified" badge (`:482-486`) appears before any registry call. The live check (`:249-281`) runs only when the officer presses a button, and it looks up by credential number, which works only within the officer's own woreda.

**Fix:** run the live check automatically when online, and show "Verified" only when the status is `active`.

### WP-CRY-003 (Medium): the QR payload is readable PII and travels in URLs and logs

**What is exposed.** The payload is base64url JSON, not encrypted. It contains:
- full name
- DOB
- gender
- resident number
- house number
- woreda and kebele
- dates

(`sign-credential/index.ts:206-219`)

**Where it travels.**
- The QR puts the whole token in the URL path (`credentialVerifyUrl`), so the PII reaches hosting request logs, browser history and shared links.
- `credential_verification_log.attempted_value` stores the full token for every lookup (`00000000000034_...:91,254-288`). Any staff member in the woreda can read it, and it has no retention policy.

**Why the page's protections do not help.** The page comments (`v.$token.tsx:21-23`, `:282-289`) and `00000000000002_...:142-145` promise that anonymous visitors do not get the DOB and that withdrawn cards reveal no identity. Neither holds, because the identity is in the token itself.

**Fix:** minimise the payload, or move the token to the URL fragment. Log a digest instead of the token.

### WP-CRY-004 (Low): no `kid`, versioning or rotation runbook for the signing key

There is one compiled-in public key (`credentialCryptoConfig.ts:14-17`), and the token has no key-id segment (`sign-credential/index.ts:245`). Rotation, even after a compromise, turns every legitimate card into "Not a valid card". There is no custody, escrow or compromise procedure (acknowledged at `docs/system-review-2026-09.md:436`), and one key serves all woredas. Key strength is fine: P-256 gives about 128-bit security, above RSA-2048.

### WP-CRY-005 (Low): payload hygiene

- **No format or status version.** A future schema change or status-epoch revocation cannot be expressed.
- **English-only is not enforced.** `n` is `resident.full_name`. The client regex is `\p{L}` (`residentSchema.ts:7`), which accepts Ge'ez script, and the database has no Latin-only CHECK.
- **`iat` (`t`) is never checked.**
- **Expiry is date-only**, compared as UTC midnight.

### WP-CRY-006 (Medium): Phase C encryption gives no at-rest protection yet; key-hierarchy gaps

**What is sound**
- The root key is `encode(gen_random_bytes(32),'hex')` stored in Vault (`scripts/phase-c-create-vault-key.sh:55-63`).
- Per-woreda keys are derived as `hmac(woreda_id::text, root, 'sha256')` (`00000000000023_...:188`).
- Encryption is `pgp_sym_encrypt(..., 'cipher-algo=aes256')` (`:265`).
- `pii_root_key()` and `derive_woreda_key()` are revoked from PUBLIC, anon, authenticated **and service_role** (`:173,197`).
- `decrypt_pii_text()` re-checks the caller's tenant in NULL-safe form (`:351-357`).
- Blind indexes are keyed per tenant.

**Gaps**
1. **Plaintext twins remain authoritative for every encrypted column.** Stage 4 is "Not started" (`docs/security-functionality.md:196`). A dump or backup therefore exposes national ID, phone, email and all amounts in cleartext. The documentation's "closes the stolen-dump case" (`:137`) is contradicted. This is the same root cause as WP-DB-005; merge the two.
2. **No key version on ciphertext, and decrypt swallows every error to NULL** (`:362-367`). Rotating the root key would silently blank data. A missing key silently writes NULL ciphertext (`:264`).
3. **No escrow.** The key "never leaves the database" (script `:9-13`), yet the migration says to back it up alongside `HARARI_EC_PRIVATE_KEY` (`00000000000023_...:101`). As built, that is impossible.
4. **Suspended or pending staff can still decrypt.** The decrypt entitlement uses `get_user_woreda_id()`, which does not check status (WP-DB-001).
5. **Live key presence and backfill are unverified** (`pii_encryption_status()`).

**Per-column status (from migrations)**

| Column | Encrypted copy | Plaintext still stored | Blind index |
|---|---|---|---|
| resident.phone_number | `phone_number_enc` (m23) | yes | `phone_number_blind_index` |
| resident.email | `email_enc` (m23) | yes | — |
| resident.national_id_no (FAN) | `national_id_no_enc` (m44) | yes | `national_id_no_blind_index` |
| household.phone_number / email | `_enc` (m23) | yes | — |
| household.rent_amount | `rent_amount_enc` (m44) | yes | — |
| service_request.applicant_phone | `applicant_phone_enc` (m23) | yes | — |
| payment.amount | `amount_enc` (m23) | yes | — |
| rental_occupancy(.request).rent_amount | `rent_amount_enc` (m23) | yes | — |
| Rental financial tables (rent_rate_history, rent_charge, settlements, arrears, checkpoint) | `*_enc` (m76/78/80/83) | yes (NOT NULL plaintext) | — |
| resident.full_name, full_name_am, date_of_birth, father_name, mother_full_name, birth_place; household.address_line, gps_lat/lng; service_request.applicant_name, details, issued_letter_html | **none** | yes | — |
| auth passwords | Supabase Auth (bcrypt, in `auth.users`) | n/a | — |

### WP-CRY-007 (Medium): receipts are not unique per payment

**Numbering is race-safe.** `assign_receipt_number()` allocates with an atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`, and `UNIQUE (woreda_id, receipt_number)` holds (`baseline.sql:580,1004-1027`).

**But nothing stops extra receipts.** There is no `UNIQUE(payment_id)` and no trigger check (`validate_receipt_amount()`, `:1430-1443`). Any holder of `payment.collect`, `revenue.collect` or `receipt.print` can insert additional receipts for an existing confirmed payment (`:1603`). Each one:
- gets a fresh number (or a client-chosen number, `:1015`)
- gets a fresh token (or a client-chosen token, `00000000000013_...:43`)
- can carry a client-chosen `receipt_date`
- verifies publicly as "Verified" (`:179-180`)

A client-chosen number that anticipates the sequence also makes the next legitimate receipt fail on the UNIQUE constraint.

**Fix:** a partial unique index on `receipt(payment_id)`, server-only numbers and tokens, and a pinned `receipt_date`.

### WP-CRY-008 (Low): letter and receipt verification tokens

- **Non-cryptographic generator.** Tokens are 12 characters from a 32-symbol alphabet (a nominal 2^60), generated with `random()` (`baseline.sql:1236`, `00000000000013_...:28`). `random()` is not a CSPRNG and is shared across tenants on pooled backends.
- **Client values are accepted.** A client-supplied token is kept (`baseline.sql:997`).
- **Letter tokens can be changed.** Letter tokens have no pin trigger; receipt tokens do.
- **A real letter token is committed.** A live letter token and its request number are in `00000000000064_...:12-13` and in `docs/remediation-report.md:549,554,578` (`SJ44…[REDACTED]`). Anyone with the repository can verify that resident's letter anonymously.

This overlaps WP-DB-013 and adds the remediation-report locations; merge the two. **Fix:** switch to `gen_random_bytes`, add a pin trigger, and rotate the disclosed token.

### WP-CRY-009 (Info): credential-number check digit is correct

`luhn_check_digit()` is standard Luhn mod-10. It doubles from the rightmost digit of the body and always returns 0-9, so the brief's mod-11 "value 10" case cannot arise. NNNNNN is allocated per (woreda, Gregorian year) by an atomic upsert. The number cannot be client-supplied (migration 29) and is immutable (migration 46).

Residual properties:
- Luhn misses the 09↔90 transposition.
- YY comes from `NOW()` in UTC, so cards issued between 00:00 and 03:00 EAT on 1 January get the previous year.
- Uniqueness is per woreda and depends on `woreda_numeric_code`, which a super_admin can edit.

## 4. Luhn test vectors

These come from a Python port of `public.luhn_check_digit` (`00000000000002_credential.sql:22-47`). Each result was cross-checked with an independent Luhn validator (full number sum mod 10 = 0). The textbook vector `7992739871` gives 3, as expected.

| # | WW | KK | YY | NNNNNN | 12-digit body (`serial_number`) | C | `credential_number` | Validator |
|---|---|---|---|---|---|---|---|---|
| 1 | 01 | 01 | 26 | 000001 | 010126000001 | 9 | 01-01-26-000001-9 | valid |
| 2 | 01 | 05 | 26 | 000127 | 010526000127 | 3 | 01-05-26-000127-3 | valid |
| 3 | 02 | 19 | 26 | 999999 | 021926999999 | 7 | 02-19-26-999999-7 | valid |
| 4 | 06 | 12 | 25 | 000042 | 061225000042 | 1 | 06-12-25-000042-1 | valid |
| 5 | 99 | 99 | 99 | 999999 | 999999999999 | 2 | 99-99-99-999999-2 | valid |
| 6 | 01 | 00 | 00 | 000000 | 010000000000 | 8 | 01-00-00-000000-8 | valid |
| 7 | 03 | 07 | 26 | 000500 | 030726000500 | 3 | 03-07-26-000500-3 | valid |
| 8 | 04 | 11 | 26 | 000001 | 041126000001 | 2 | 04-11-26-000001-2 | valid |
| 9 | 01 | 05 | 26 | 000090 | 010526000090 | 3 | 01-05-26-000090-3 | valid; swapping to …0009-3 is **also valid** (the known 09↔90 blind spot) |

Detection check on vector 2: 0 of 117 single-digit substitutions go undetected.

## 5. Signature-encoding test vectors (throwaway key)

| Test | Result |
|---|---|
| Original token verifies | true |
| Last base64url character replaced (15 alternatives) | 15/15 still verify |
| `(r, n−s)` substituted | verifies; token string differs |
| Payload readable with no key | yes: full JSON incl. DOB and house number |

## 6. Checklist verdicts

| ID | Status | Note |
|---|---|---|
| A-08 (encryption) | **FAIL** | The AES-256 per-tenant design exists, but every encrypted column keeps an authoritative plaintext twin, and names, DOB and GPS are unencrypted (WP-CRY-006). |
| E-03 (QR) | **PARTIAL** | ES256 is asymmetric and pinned, `exp` is checked (date-only), `iat` is unchecked, there is no `kid`, and signature malleability defeats the status check. |
| CRY-01 | **PARTIAL** | Key location PASS (Edge secret only; none in repo, history, DB or bundle). No `kid` and no rotation plan. ES256 is used instead of RS256. |
| CRY-02 | **PARTIAL** | Size, canonicalisation, expiry and algorithm pinning PASS. No status or format version. English-only is not enforced. |
| CRY-03 | **FAIL** | An online check exists but fails open to green, and the lookup can be forced to miss without the key. The staff scanner's check is optional. No residual-risk statement. |
| BL-01 | **PARTIAL** | Atomic upsert plus UNIQUE for both credentials and receipts. Receipts accept client numbers and tokens and are not unique per payment; counters are staff-writable (WP-DB-006). |

## 7. Documentation drift (highlights; full list in JSON)

- **Contradicted**
  - The brief's RS256: the implementation is ES256.
  - The brief's mod-11 check digit: the implementation uses Luhn; the hyphenated shape does match.
  - CLAUDE.md "verify_credential_token is deliberately not rate-limited": it has been rate-limited since migration 34.
  - "The DOB is only returned to staff": the DOB is in the QR.
  - The docs say Phase C "closes the stolen-dump case": plaintext twins remain.
  - "Back up pii_root_key with the EC key": the key never leaves the database.
  - Go-live dimension G is "Green": WP-CRY-001 contradicts it.
- **Not found**
  - `safeBase64Encode/Decode`: they do not exist. The byte-level replacement is Unicode-safe.
  - Live application of Phase C stages 1-3: needs live verification.
- **Confirmed**
  - ES256 and the location of the public key.
  - The 13-digit Luhn credential number.
  - The receipt RPC checks voided status.
  - The ~2^60 nominal token entropy.
  - The missing rotation runbook.

## 8. Residual risk and blockers

- **Blocker for go-live of the public verifier:** WP-CRY-001. Until it is fixed, a revoked card can be presented as valid to any relying party that scans it.
- **Offline revocation (after fixes):** a fully offline verifier can never see revocation. With 1-year validity, the maximum stale-acceptance window is one year. This should be written down as accepted residual risk, alongside an instruction to relying parties to require the online (green) verdict for high-value decisions.
- **Needs live verification:**
  - that `HARARI_EC_PRIVATE_KEY` is set and is a PKCS#8 P-256 key
  - `pii_encryption_status()` (key present, backfill complete)
  - the IP header used by `rate_limit_hit` behind Supabase's proxy
  - that the committed letter token is still live
