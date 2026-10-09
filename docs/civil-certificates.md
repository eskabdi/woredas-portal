# Civil-registration certificates

Birth, death, marriage, divorce and adoption certificates: the field model,
the super-admin template builder, data capture, printing, and the security
controls. Introduced by migration `00000000000101_civil_certificate_templates.sql`;
issuance with a verification QR (printing as the last workflow step, the
way ID cards are printed) by `00000000000102_civil_certificate_issuance_qr.sql`
and `00000000000103_civil_certificate_print_woreda_anchor.sql`.

## Actors

| Actor                                                                                         | Can                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Super admin with `console.certificate_template.manage` (or unrestricted)                      | Upload a certificate background, drag data fields onto the page, choose language and date format, save the draft, publish, discard.   |
| Woreda staff with `civil.register` / `civil.create_event` / `civil.verify` / `civil.resubmit` | Capture certificate details on a civil event until it is registered.                                                                  |
| Woreda staff with `civil.print_certificate`                                                   | Print and issue the certificate of a registered event (first print), once its template is published. The event becomes `issued`.      |
| Woreda staff with `civil.authorize_reprint`                                                   | Reprint an issued certificate, with a reason (at least 5 characters). Same token, same QR; the print number goes up.                  |
| Woreda staff with `civil.read`                                                                | View the certificate of an issued event on screen (no print, no reprint).                                                             |
| Anyone with the printed certificate                                                           | Scan the QR to open `/verify/certificate/<token>`, which shows the certificate's type, registration number, names and issuing office. |
| Anyone else                                                                                   | Nothing. Drafts are readable only with the console permission; captured data follows the `vital_event` read policy (migration 99).    |

## Field model

`src/config/certificateFields.ts` is the single catalog. It defines every
field of the five certificates (from the specification supplied by the
system owner), its Amharic and English label, its palette group, its kind and
its source:

| Group            | Examples                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifiers      | register form number, registration unique ID (`vital_event.event_number`), birth-registration IDs of the people involved                                                                             |
| Applicant        | child / deceased / wife / divorcee 1 / adoptee: name, father's name, grandfather's name (Ethiopian three-part name), sex, date of birth, place / region / zone / woreda of birth, nationality, title |
| Spouse / Parents | husband, divorcee 2, mother's and father's full name and nationality                                                                                                                                 |
| Event            | date and place of the event, registration date, certificate issue date, issuing woreda, marriage place breakdown (region, zone, city, sub-city, woreda, kebele)                                      |
| Registrar        | registrar's name / father's name / grandfather's name (split from the registrar's `app_user.full_name`), signature (`app_user.signature_path`), woreda seal (`woreda_settings.stamp_url`)            |

Kinds and the formats a placed field can choose:

| Kind      | Stored as                       | Formats                                                                                                                                |
| --------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| bilingual | `<key>_am`, `<key>_en`          | Amharic, English, Amharic / English                                                                                                    |
| date      | ISO `yyyy-mm-dd` (Gregorian)    | Ethiopian full / day / month / year; Gregorian full / day / month / year. Ethiopian dates use Arabic numerals and Amharic month names. |
| sex       | `male` / `female`               | ወንድ/Male, ሴት/Female, both                                                                                                              |
| text      | as typed                        | as entered                                                                                                                             |
| image     | storage path                    | image                                                                                                                                  |
| qr        | `vital_event.certificate_token` | image (a QR of the public verify URL; placeholder until the certificate is issued)                                                     |

Captured values live in `vital_event.event_details.certificate`. Dates the
event row already holds (event date, registration date) are used when the
captured value is empty.

## Data flow

```mermaid
flowchart LR
  SA[Super admin] -->|drag fields, format, publish| ED[admin.certificate-templates]
  ED -->|draft rows| DR[(certificate_template_field_draft)]
  ED -->|background| BK[(storage: certificate-templates)]
  ED -->|publish_certificate_template| LV[(certificate_template_field)]
  CL[Civil registrar] -->|capture, prefill| CD[CertificateDetailsCard]
  CD -->|event_details.certificate| VE[(vital_event)]
  PR[Staff with civil.print_certificate] --> PT[woreda.civil.$eventId.certificate]
  PT -->|record_civil_certificate_print| IS[(vital_event: issued, certificate_token)]
  PT --> PL[(civil_certificate_print_log)]
  QR[Citizen / third party scans QR] --> VF[verify.certificate.$token]
  VF -->|verify_civil_certificate, anon| IS
  LV --> PT
  VE --> PT
  AU[(app_user: registrar, signature)] --> PT
  WS[(woreda_settings: seal)] --> PT
  PT -->|html2canvas-pro + jsPDF, anchor click| PDF[A4 PDF]
```

## Issuance workflow

A civil event is registered by the existing maker-checker workflow
(draft → submitted → verified → approved → registered). Printing the
certificate is the last step, mirroring residence ID cards:

```mermaid
stateDiagram-v2
  registered --> issued: record_civil_certificate_print (civil.print_certificate)
  issued --> issued: reprint with reason (civil.authorize_reprint)
```

`registered → issued` is a `workflow_transition` row, so the generic FSM
trigger still applies, but a user session cannot take it with a plain
`UPDATE`: `trg_guard_vital_event_issuance` rejects any change to `status`
→ `issued`, `certificate_token`, `issued_at` or `issued_by_user_id` unless the
transaction-local flag `app.certificate_issue` is set, which only
`record_civil_certificate_print` sets. A client-supplied token on insert is
rejected too.

`record_civil_certificate_print(_vital_event_id, _reprint_reason)`, in one
transaction:

1. Resolves the caller's woreda and requires the event in it, `registered`
   or `issued`, with a published template for its type.
2. First print: requires `civil.print_certificate`; generates
   `certificate_token` (`gen_certificate_token()`, CSPRNG, 26 symbols from
   an unambiguous 32-letter alphabet, 130 bits), sets `issued_at`/`issued_by_user_id`
   and moves the event to `issued`.
3. Reprint: requires `civil.authorize_reprint` and a reason of at least 5
   characters. The token never changes, so every copy carries the same QR.
4. Appends a row to `civil_certificate_print_log` (print number, reprint
   flag, reason, who, when; the number is scoped to the caller's woreda)
   and an `audit_log` row (`CERTIFICATE_ISSUED` / `CERTIFICATE_REPRINTED`).
5. Returns the token, the print number and the reprint flag. The page then
   renders the QR and produces the PDF.

The QR encodes `${VITE_PUBLIC_SITE_URL}/verify/certificate/<token>`
(`src/config/certificateVerify.ts`), never `window.location.origin`, so a
certificate printed from a laptop on localhost still carries a working QR.
The template builder inserts the QR at 25 mm square, keeps it square on
resize and warns below 20 mm. The text field `verification_code` prints the
same token for manual entry.

`verify_civil_certificate(_token)` (anon + authenticated) checks the token
format, returns a row only for an `issued` event, and discloses only what is
already printed on the certificate: type, registration number, event,
registration and issue dates, the two principal names (Amharic and English)
and the issuing woreda. The public page fails closed: a malformed token, an
RPC error or no row all show "Not verified".

## Permissions

| Permission                | tenant_admin | supervisor | civil_registrar | registry_clerk | print_officer |
| ------------------------- | :----------: | :--------: | :-------------: | :------------: | :-----------: |
| `civil.print_certificate` |      ✓       |            |        ✓        |       ✓        |       ✓       |
| `civil.authorize_reprint` |      ✓       |     ✓      |                 |                |       ✓       |

`print_officer` also gains `civil.read` and `civil.view` (it cannot print
what it cannot open). Migration 102 regenerates `default_role_perms()` and
backfills `role_permission`, leaving any cell a tenant administrator has
already edited (`updated_by IS NOT NULL`) untouched.

## Entities

```mermaid
erDiagram
  certificate_template ||--o{ certificate_template_field : "live placements"
  certificate_template ||--o{ certificate_template_field_draft : "draft placements"
  certificate_template {
    text certificate_type PK "birth|death|marriage|divorce|adoption"
    text background_path "certificate-templates/<type>/background.*"
    text orientation "portrait|landscape (A4)"
    boolean is_published
    timestamptz published_at
    uuid updated_by FK
  }
  certificate_template_field {
    uuid certificate_field_id PK
    text certificate_type FK
    text field_key "catalog key, or static_text"
    text format "am|en|am_en|plain|image|ec_*|gc_*"
    text binding_mode "data|static"
    text static_value
    numeric x "percent of page"
    numeric y
    numeric width
    numeric height
    numeric font_size "points"
    text font_family "Tayitu|Jiret|Noto Sans Ethiopic|Times New Roman|Arial"
  }
  vital_event ||--o{ civil_certificate_print_log : "prints"
  vital_event {
    text certificate_token UK "issued certificates only"
    timestamptz issued_at
    uuid issued_by_user_id FK
  }
  civil_certificate_print_log {
    uuid print_log_id PK
    uuid vital_event_id FK
    uuid woreda_id FK
    integer print_no
    boolean is_reprint
    text reprint_reason
    uuid printed_by_user_id FK
    timestamptz printed_at
  }
```

`vital_event.event_type` also accepts `adoption` (numbering code `AD`), and
`resolve_civil_fee()` maps divorce (previously unmapped) and adoption to
zero-fee `fee_schedule` rows that each woreda can price in Settings.

## Interfaces

| Interface                                                          | Type                  | Classification          | Notes                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `certificate_template`, `certificate_template_field`               | PostgREST SELECT      | Private (authenticated) | Read by every signed-in user so woredas can print.                                                                                           |
| `certificate_template_field_draft`                                 | PostgREST CRUD        | Private (console)       | RLS: `user_has_console_perm('console.certificate_template.manage')`.                                                                         |
| `certificate_template` UPDATE                                      | PostgREST             | Private (console)       | Background path, orientation.                                                                                                                |
| `publish_certificate_template(_type)`                              | RPC, SECURITY DEFINER | Private (console)       | Checks the console permission as the caller, replaces the live placements with the draft in one transaction, writes an audit row.            |
| `discard_certificate_template_draft(_type)`                        | RPC, SECURITY DEFINER | Private (console)       | Restores the draft from live; audit row.                                                                                                     |
| `vital_event.event_details.certificate`                            | PostgREST UPDATE      | Private (tenant)        | Existing `vital_event_update` policy (civil keys, own woreda); frozen once registered.                                                       |
| `storage: certificate-templates`                                   | Storage               | Private                 | Read: authenticated. Write/delete: console permission. PNG/JPEG/WebP, 10 MB.                                                                 |
| `record_civil_certificate_print(_vital_event_id, _reprint_reason)` | RPC, SECURITY DEFINER | Private (tenant)        | First print `civil.print_certificate`, reprint `civil.authorize_reprint` + reason. Issues the token, logs, audits. Not executable by `anon`. |
| `verify_civil_certificate(_token)`                                 | RPC, SECURITY DEFINER | **Public**              | Anon. Token format checked, `issued` only, returns only what is printed on the certificate.                                                  |
| `civil_certificate_print_log`                                      | PostgREST SELECT      | Private (tenant)        | Civil module family, own woreda. No client writes.                                                                                           |

## Security controls

- **Authorization** is enforced in the database, not only the UI: draft and
  template writes, the publish/discard RPCs and the bucket all check
  `console.certificate_template.manage` (P1-7 pattern). The live placement
  table has no client write policy at all; only the publish RPC writes it.
- **Integrity of issued certificates**: `trg_pin_vital_event_certificate`
  rejects any change to `event_details.certificate` from a user session once
  the event is registered or issued, so what prints is what was approved.
  The print route prints only registered or issued events, and only from the
  published template.
- **Input validation**: field keys match `^[a-z0-9_]{1,64}$`, formats,
  fonts, alignment, colour (`#rrggbb`), geometry (0–100 %) and font size are
  CHECK-constrained; static text is capped at 500 characters; captured
  values are trimmed and capped at 300 characters. Values render as React
  text nodes (no HTML), so a captured value cannot inject markup.
- **Issuance integrity**: issuing, the token and the issue stamp can only
  change inside `record_civil_certificate_print` (GUC guard), so a direct
  PostgREST write cannot mark an event issued or plant a token. Reprints
  require a separate permission and a reason, and keep the original token.
- **Verification**: 130-bit unguessable tokens; the public RPC returns only
  printed data and only for issued events; the page fails closed.
- **Audit**: field add/remove, draft save, background upload, orientation,
  publish, discard, certificate details saved, certificate issued and
  reprinted (with the print number and reason), plus the print log.
- **Tenant isolation**: captured data inherits `vital_event` RLS (woreda +
  `civil.*` family, migration 99); registrar and seal are read from the
  caller's own woreda.
- **Print pipeline**: dedicated capture node at paper width, `html2canvas-pro`,
  images converted to data URLs first (no CORS dependency), PDF opened with an
  anchor click (pdf-print-pipeline skill).

## Open items

- Amharic labels were written for this feature and should get a
  native-speaker review before the first certificates are issued.
- Each woreda should set the divorce and adoption fees in Settings (seeded at
  0 ETB like the other civil registration fees).
- No certificate template is published yet: a platform administrator must
  upload each blank certificate, place the fields and the verification QR
  (from the Identifiers group) before printing works.
- Certificate tokens, like letter and receipt tokens, are not rate-limited
  at the verify RPC; at 130 bits enumeration is not practical.
