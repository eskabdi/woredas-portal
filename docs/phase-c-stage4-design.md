# Phase C stage 4 — design (not yet implemented)

**Status: design only. No migration exists yet, nothing in this document has
been applied to production.** This is the artifact requested when stage 4 was
first raised: resolve the open design questions and produce a concrete,
reviewable plan before writing anything destructive.

## Why this needed its own design pass

The original rollout note (`00000000000023_pii_encryption.sql`'s header) scoped
stage 4 as "drop the plaintext columns" and flagged one open question (the
`amount > 0` guard). Working through it concretely surfaces that it is
actually **two phases**, not one:

- **4a — write-path cutover.** Every write that currently targets a plaintext
  encrypted column (`resident.phone_number`, `payment.amount`, etc.) does so
  directly, relying on the sync triggers added in migration 23 to keep the
  `_enc` column in step. Once a plaintext column is dropped, there is nothing
  left for a trigger to read — the column the application currently writes to
  no longer exists. Every one of those write call sites needs a new route to
  the encrypted column *before* the drop, not after.
- **4b — the actual column drop**, plus the two guards that read the plaintext
  columns today: `payment_amount_check`/`rental_occupancy_rent_amount_check`
  (`amount > 0` / `rent_amount > 0`) and `resident_email_format` (an email
  regex CHECK on `resident.email` — a second guard the original note didn't
  mention at all, found during this pass).

4a is additive and safe to build and ship independently. 4b is the destructive
step and depends on 4a being fully deployed and burned in first.

## Decisions already made

- **Guard mechanism (both `amount > 0`-style guards and the newly-found email
  format guard):** a non-secret boolean column, set by the write path (RPC or
  trigger, see below) from the plaintext value *before* it's ever dropped,
  enforced by a `CHECK` constraint afterward. Chosen over decrypt-and-check
  (reintroduces the exact fail-soft/three-valued-logic trap this codebase
  already fixed once — a NULL decrypt would make `NULL <= 0` evaluate to
  `NULL`, and a plpgsql `IF` treats a NULL condition as false, silently
  skipping the guard) and over dropping DB-level enforcement entirely.
- **Sequencing:** design and build 4a now; do not touch production schema
  (4b) until 4a has shipped, been verified, and stage 3's current deploy has
  had a real burn-in period with no issues.

## Verified write-site inventory

Traced fresh via `grep`, not from memory — every place in `src/` that writes
one of the six encrypted fields:

| Field | Call sites | Shape |
| --- | --- | --- |
| `resident.phone_number` / `.email` | `woreda.residents.new.tsx:91` (insert), `woreda.residents.$residentId.edit.tsx:207` (update) | both via `buildResidentPayloadCore` |
| `household.phone_number` / `.email` | `woreda.households.new.tsx:101` (insert), `woreda.households.$householdId.edit.tsx:137` (update) | both via `buildHouseholdPayload` |
| `service_request.applicant_phone` | `woreda.services.new.tsx:184` (insert only — never edited afterward) | |
| `payment.amount` | `woreda.services.$requestId.index.tsx:325` (service fee), `woreda.revenue.index.tsx:594` (rental rent), `woreda.credentials.$requestId.index.tsx:1414` (credential fee) | insert only — no payment-editing flow exists anywhere in the app |
| `rental_occupancy_request.rent_amount` | `woreda.rental-houses.$houseId.index.tsx:486,507` (new registration / termination requests) | insert only |
| `rental_occupancy.rent_amount` | **none directly** — see below | |

**`rental_occupancy.rent_amount` has no application write path at all.** It is
populated entirely by `apply_rental_occupancy_on_approval()`
(`baseline.sql:863`), a `BEFORE UPDATE ON rental_occupancy_request` trigger
that fires when a request's status transitions to `'approved'` and does:

```sql
INSERT INTO public.rental_occupancy (..., rent_amount, ...)
VALUES (..., COALESCE(NEW.rent_amount, 0), ...)
```

reading `NEW.rent_amount` — the plaintext column on `rental_occupancy_request`
— directly. This is a second, less obvious write path into an encrypted
column, and it breaks the same way the sync triggers would once
`rental_occupancy_request.rent_amount` is dropped. **This trigger needs its
own fix as part of 4a**, not just the 11 direct call sites above.

Also checked and confirmed clean: `ResidentActions.tsx`'s five `resident`
writes and `ResidentProfileTabs.tsx`'s `household` write are all
status/assignment updates (`residency_status`, `active_flag`,
`current_household_id`) — none touch an encrypted field, none need to change.

## Architecture: `SECURITY INVOKER` RPCs, not `SECURITY DEFINER`

The obvious-looking design — a `SECURITY DEFINER` RPC that calls the existing
internal `encrypt_pii_text`/`encrypt_pii_numeric` (currently `service_role`-only)
— has the same shape as the exact defect
`00000000000006_view_security_invoker.sql` fixed on the read side: a
`SECURITY DEFINER` function runs as its owner, which means the base table's
RLS `WITH CHECK` policies (tenant + permission) are evaluated against the
*function owner*, not the caller, unless the function re-derives and checks
`get_user_woreda_id()`/`user_has_perm()` itself. That means duplicating, in
every one of ~6 new RPCs, logic the table's own RLS already gives for free —
and a bug in any one duplicate is a direct write-side tenant-isolation bypass.

**Recommendation: keep the new RPCs `SECURITY INVOKER`** (the default), and
instead broaden exactly two of the existing internal primitives:

- `encrypt_pii_text(text, uuid)` and `encrypt_pii_numeric(numeric, uuid)` —
  **grant `EXECUTE` to `authenticated`.** This is safe in a way decrypt is
  not: encryption is one-way and non-leaking. A caller who can encrypt a
  string they already know the plaintext of learns nothing about any other
  row. (They still cannot decrypt anything — `decrypt_pii_text`/`_numeric`
  stay exactly as tenant-gated and restricted as they are today.)
- **Do not** grant `phone_blind_index(text, uuid)` broadly — it takes an
  arbitrary `_woreda_id`, so an open grant would let a caller compute another
  tenant's blind-index hash space offline. Instead add a `my_phone_blind_index`-style
  writer wrapper, `my_phone_blind_index_for_write(text)`, that resolves the
  caller's own `get_user_woreda_id()` server-side exactly like the existing
  read-side helper — mirroring a pattern already proven correct in this
  codebase rather than inventing a new one.

With that, a `SECURITY INVOKER` RPC's own `INSERT`/`UPDATE` against the base
table runs as the calling `authenticated` user, so the table's existing RLS
policies (`resident_insert`, `payment_insert`, etc.) apply exactly as they do
today — zero duplicated authorization logic, and the same audit trail
(`force_actor_columns` and friends) keeps working unchanged.

## RPC design, by field category

Two different shapes, matched to how much atomicity each field actually needs:

**Contact fields (resident/household phone+email, service_request
applicant_phone).** Low stakes if briefly unset — nothing depends on these for
correctness the way the financial guards do. Keep the existing `.insert()`/
`.update()` for every other column on the row unchanged (those columns aren't
moving), just drop the PII keys from that payload once the plaintext columns
are gone, and follow with one small RPC call to set them:

```sql
CREATE FUNCTION public.set_resident_contact(_resident_id uuid, _phone text, _email text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  UPDATE public.resident
  SET phone_number_enc = public.encrypt_pii_text(_phone, woreda_id),
      phone_number_blind_index = public.my_phone_blind_index_for_write(_phone),
      email_enc = public.encrypt_pii_text(_email, woreda_id)
  WHERE resident_id = _resident_id;
  -- The UPDATE above runs as the caller (SECURITY INVOKER), so
  -- resident_update's own RLS WITH CHECK still gates it -- no separate
  -- tenant check needed here.
END $$;
```

One of these per table (`set_resident_contact`, `set_household_contact`,
`set_service_request_applicant_phone`), called once right after the base
insert/update succeeds. Two round trips instead of one, but a briefly-unset
phone/email on a row that already exists is a cosmetic gap, not a correctness
one.

**Financial fields (`payment.amount`, `rental_occupancy_request.rent_amount`).**
These carry a real integrity guard (`amount > 0`) that must not have a window
where it can be bypassed. Replace the whole `.insert()` with one RPC that
does the complete row insert atomically, encrypts, and enforces the guard
before anything commits:

```sql
CREATE FUNCTION public.record_payment(
  _woreda_id uuid, _resident_id uuid, _household_id uuid,
  _payment_type text, _amount numeric, _channel text,
  _payment_date date, _reference_no text,
  _credential_request_id uuid, _rental_request_id uuid, _service_request_id uuid,
  _posted_by_user_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE _payment_id uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero';
  END IF;
  INSERT INTO public.payment (
    woreda_id, resident_id, household_id, payment_type, status,
    amount_enc, amount_positive, channel, payment_date, reference_no,
    credential_request_id, rental_request_id, service_request_id, posted_by_user_id
  ) VALUES (
    _woreda_id, _resident_id, _household_id, _payment_type, 'confirmed',
    public.encrypt_pii_numeric(_amount, _woreda_id), true, _channel, _payment_date, _reference_no,
    _credential_request_id, _rental_request_id, _service_request_id, _posted_by_user_id
  ) RETURNING payment_id INTO _payment_id;
  RETURN _payment_id;
END $$;
```

(Illustrative — final column list/defaults need a pass against every one of
the three call sites' actual payloads, they're not identical.) Same shape for
`record_rental_request_amount(...)`, called from
`woreda.rental-houses.$houseId.index.tsx`'s two write sites.

## `apply_rental_occupancy_on_approval()` fix

Once `rental_occupancy_request.rent_amount` is dropped, this trigger's
`COALESCE(NEW.rent_amount, 0)` breaks. It needs to read the encrypted value
instead and write both the encrypted column and the guard boolean on the new
`rental_occupancy` row directly:

```sql
INSERT INTO public.rental_occupancy (
  woreda_id, rental_house_id, resident_id, household_id,
  rent_start_date, rent_amount_enc, amount_positive, status, originating_request_id
) VALUES (
  NEW.woreda_id, NEW.rental_house_id, NEW.resident_id, NEW.household_id,
  COALESCE(NEW.rent_start_date, CURRENT_DATE),
  NEW.rent_amount_enc,  -- copy ciphertext directly, no decrypt/re-encrypt needed
  COALESCE(NEW.amount_positive, false),
  'active', NEW.rental_request_id
)
```

Copying `NEW.rent_amount_enc` (already encrypted under the *same* per-tenant
key, since both rows share `woreda_id`) straight across avoids a
decrypt-then-re-encrypt round trip entirely, and can't hit the fail-soft NULL
case the way a decrypt-based approach would.

## Migration sequencing

**4a (safe to build and ship independently, additive only):**
1. Add `amount_positive boolean` to `payment` and `rental_occupancy`; add
   `email_format_valid boolean` to `resident`. Backfill from the current
   plaintext (`amount > 0`, `email ~* '...'`) for existing rows.
2. Ship the six new `set_*`/`record_*` RPCs and the `my_phone_blind_index_for_write`
   helper; grant `encrypt_pii_text`/`encrypt_pii_numeric` to `authenticated`.
3. Fix `apply_rental_occupancy_on_approval()` to read `rent_amount_enc` and
   set `amount_positive`, still alongside the existing plaintext path (both
   can coexist harmlessly while the plaintext column is still present).
4. Switch the 8 call sites (11 write sites) to call the new RPCs instead of
   writing the plaintext columns directly. Each of these is a normal,
   reviewable app-code change — no schema risk.
5. Full verification pass (dry-run harness extended to cover the RPCs,
   `tenant-isolation-review`, live browser verification of every write flow:
   register/edit a resident, register/edit a household, submit a service
   request, collect each of the three payment types, submit a rental
   registration/termination request) — this is where a write-side bug would
   actually surface, unlike stage 3 which only touched reads.

**4b (destructive, gated on 4a being live and burned in):**
1. `DROP VIEW` on the five/six decrypting views that still do `SELECT t.*`
   (must happen before the column drop, already noted in migration 23).
2. `ALTER TABLE ... DROP COLUMN` for all eight plaintext columns.
3. Drop `payment_amount_check`/`rental_occupancy_rent_amount_check`/
   `resident_email_format` (their target columns are gone); add
   `CHECK (amount_positive)` / `CHECK (rent_amount_amount_positive)` /
   `CHECK (email_format_valid)` in their place.
4. Recreate the views without the now-gone plaintext columns in their
   `SELECT`.
5. Drop the now-dead sync triggers (`resident_pii_sync`, `payment_amount_sync`,
   etc.) — nothing writes the plaintext columns anymore for them to react to.

## Open items this design does not resolve

- **Exact RPC parameter lists** — the illustrative signatures above need to be
  checked field-by-field against each call site's actual current payload
  (e.g. does `services.$requestId.index.tsx`'s service-fee payment pass every
  field `record_payment` above assumes, or does it need its own narrower
  variant?). Mechanical, but needs doing before any code is written.
- **`docs/erd.md` / `docs/api-security.md`** need a new "RPC" section once
  these ship — six new callable functions is exactly the kind of surface
  `api-security.md`'s manifest exists to track.
- ~~Whether Edge Functions or scripts reference these plaintext columns
  directly~~ — checked: no Edge Function touches any of the six encrypted
  columns, and every `phone_number`/`email`/`amount`/`rent_amount` match in
  `seed.sql` is a different column on a different table entirely
  (`woreda_settings.contact_phone`/`.contact_email`, `service_type.fee_amount`).
  The write surface really is the 11 call sites + the one trigger above —
  nothing outside the RLS/RPC surface needs touching.
