# Ethiopian Locale Conventions — audit-locale (Appendix B, ET-01..ET-13)

Repository `eskabdi/woredas-portal` @ `9950f16`. Audit date 2026-09-24 (14 መስከረም 2019 EC). Read-only; no tracked
file was modified. Raw evidence: `raw/locale-ec-vectors.txt`, `raw/locale-scans.txt`, `raw/locale-glossary-coverage.txt`.
Machine-readable output: `findings/locale.json`.

## Summary

The Ethiopian-calendar converter is correct. Every conversion vector passes, including both Pagume lengths and a
200-year round-trip sweep, and Ge'ez numerals appear nowhere in the repository. Most of the other conventions hold
only partly. Four checklist items fail outright or have a Medium finding behind them:

- No Ethiopian clock anywhere. All times are shown on the Western 24-hour clock.
- No EC fiscal year.
- Phone and FAN formats are validated only in the browser.
- The rental module stores due dates one day early for anyone using the product in Ethiopia's time zone.

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 5 | WP-LOC-001, -002, -003, -004, -005 |
| Low | 7 | WP-LOC-006 … -012 |
| Info | 2 | WP-LOC-013, -014 |

## Checklist verdicts

| ID | Status | Basis |
|---|---|---|
| ET-01 EC primary display | PARTIAL | EC-first on most screens; Gregorian-only/first exceptions and 3 native Gregorian pickers (WP-LOC-004) |
| ET-02 No Ge'ez numerals | PASS | 0 code points U+1369–U+137C repo-wide; no Intl `ethiopic` numbering |
| ET-03 EC conversion + Pagume | PASS | 13/13 vectors, 73,414-day sweep, Pagume selectable (caller defects: WP-LOC-001, -008) |
| ET-04 EC fiscal year | FAIL | No fiscal-year concept anywhere (WP-LOC-003) |
| ET-05 Ethiopian clock | FAIL | Local time is displayed, always 24-hour Western (WP-LOC-002) |
| ET-06 Name structure | PARTIAL | Three-part Amharic name in forms; not enforced in DB; no short-name helper (WP-LOC-010) |
| ET-07 ETB only | PASS | No `$`/USD in money output; locale-dependent separators noted |
| ET-08 Tayitu/Jiret | PARTIAL | Fonts present and ordered; print/PDF use Noto only (WP-LOC-007) |
| ET-09 Amharic verbatim | PARTIAL | No approved source; glossary stale; sign-off pending (WP-LOC-009) |
| ET-10 Hierarchy, kebele reference-only | PASS | No kebele authority; Gott level absent (WP-LOC-013, Info) |
| ET-11 Woreda IDs 1–6, 19 kebeles | PASS | Seed matches README spec exactly; one Amharic spelling differs (WP-LOC-014) |
| ET-12 +251 / 16-digit FAN, client + DB | FAIL | Client only (WP-LOC-005) |
| ET-13 camelCase TS / snake_case SQL | PASS | 236 SQL objects and 618 TS functions consistent |

## EC conversion test vectors (ET-03)

`src/utils/ethiopianCalendar.ts` uses the standard JDN algorithm. It has two epoch constants that are deliberately
365 apart, one for each formula shape, and the file comments explain this. EC leap years are the ones where
`year % 4 === 3`. The vectors below were run with `bun` under `TZ=Africa/Addis_Ababa`. Every one also round-trips
back through `ethiopianToGregorian()`.

| # | Gregorian | Expected EC | Result |
|---|---|---|---|
| 1 | 2024-09-11 | 1 መስከረም 2017 (Meskerem 1) | PASS |
| 2 | 2024-09-10 / 2026-09-10 | 5 ጳጉሜ 2016 / 5 ጳጉሜ 2018 (Pagume 5, common year) | PASS |
| 3 | 2023-09-11 / 2027-09-11 | 6 ጳጉሜ 2015 / 6 ጳጉሜ 2019 (Pagume 6, leap year) | PASS |
| 4 | 2026-09-10 → 2026-09-11 | 5 ጳጉሜ 2018 → 1 መስከረም 2019 (year boundary) | PASS |
| 5 | 2024-02-29 / 2028-02-29 | 21 የካቲት 2016 / 21 የካቲት 2020 (Gregorian leap day) | PASS |
| 6 | 2026-09-24 (today) | 14 መስከረም 2019 | PASS |
| + | 2027-01-07 | 29 ታኅሣሥ 2019 (Genna) | PASS |
| + | every day 1900-01-01 … 2100-12-31 | round trip | 0 mismatches |

`isValidEthiopianDate` correctly rejects Pagume 6 in 2018 and accepts it in 2015 and 2019. `<EthiopianDateInput>`
lists all 13 months, including ጳጉሜ. The existing vitest file `src/utils/__tests__/ethiopianCalendar.test.ts` already
covers Pagume 6 and round trips. It does not run under a UTC+3 time zone, which is why WP-LOC-001 was not caught.

## Findings

### WP-LOC-001 — Rent due dates are stored one day early in the Ethiopian time zone (Medium, Rental)

`ethiopianToGregorian()` returns a date at local midnight. `woreda.rental-accounts.$occupancyId.tsx` then turns it
into text with `.toISOString().slice(0, 10)` in two places:

- line 263: the `_due_date` sent to `generate_rent_charges()`
- line 56: `addEthiopianMonths()`, which produces every arrears installment after the first (line 376)

`toISOString()` converts to UTC first. At UTC+3, local midnight is 21:00 the previous day, so each date is one day
early. Reproduced under Addis Ababa time:

- Tikimt 10 2019 is sent as 2026-10-19 instead of 2026-10-20.
- One month after 2026-09-24 is computed as 2026-10-23 instead of 2026-10-24.

Several database functions then mark rows overdue with `due_date < current_date`: migrations 82:125, 89:526 and
83:297/616, the last of which is the service-request rental checkpoint. As a result, charges become overdue a day
before the policy allows, and residents can be flagged by the checkpoint early. A second defect is in the same
helper: a plan that starts in Pagume skips Meskerem, because month 13 + 1 maps to Tikimt.

**Fix:** add a local-getter `toIsoDateLocal()` helper and use it at both call sites. Handle month 13 explicitly in
`addEthiopianMonths()`. Add a vitest case that runs with `TZ=Africa/Addis_Ababa`.

### WP-LOC-002 — No Ethiopian clock (Medium, Platform)

There is no helper that converts to Ethiopian hours and no period labels (ጠዋት/ቀትር/ማታ/ለሊት) anywhere in the code.
`formatEthiopianDateTime()` produces output like "14 መስከረም 2019 19:00". Every other place that shows a time uses
en-GB 24-hour formatting:

- dashboard activity feed (dashboard.tsx:612)
- audit trail rows and detail (audit.tsx:529, :602)
- service-request "submitted" field (services.$requestId.index.tsx:566)
- rental request history (fmtDateTime, rental-houses.requests.$requestId.index.tsx:57-63)
- workflow history (HistoryTimeline.tsx:107)
- offline-sync bar (OfflineStatusBar.tsx:99)
- the printed revenue receipt (receipt.tsx:484)

Under the owner's convention, 19:00 should read "1:00 ማታ".

**Fix:** add `formatEthiopianTime()` implementing `EtHour = ((h + 6) mod 12) || 12` with period labels, show the
Western time second, and cover the four anchor vectors with unit tests.

### WP-LOC-003 — No EC fiscal year (Medium, Revenue/Reports)

Nothing in the code, migrations or docs refers to a fiscal year, በጀት ዓመት or a budget year. The date controls
available are:

- Reports: rolling 7d/30d/90d/1y windows and free date ranges.
- Revenue: two native Gregorian date pickers.
- Dashboard: "quarterly" means Gregorian quarters, labelled "Q3 2026".

No report can be scoped to Hamle 1 – Sene 30 without the operator working out the Gregorian boundaries by hand.

**Fix:** add `ethiopianFiscalYearRange(efy)`, offer an EFY preset, switch the revenue filters to
`<EthiopianDateInput>`, and use EFY quarters on the dashboard.

### WP-LOC-004 — Some screens show Gregorian dates only or first (Medium, Platform)

Enumerated exceptions to EC-first display:

- **Gregorian only:**
  - the service/complaint list "submitted" column and its export (ServiceRequestList.tsx:385, :265)
  - the approvals inbox date column (approvals.tsx:216)
  - the service-request detail "submitted" field (services.$requestId.index.tsx:566)
  - the revenue export "Date" column, raw (revenue.index.tsx:203)
  - the audit CSV, which exports a UTC ISO timestamp (audit.tsx:339)
  - the "Printed:" footer on four printed documents (residents :203, households :168, occupant :216, reports :278)
- **Gregorian first:** the AppShell header badge (AppShell.tsx:481-486).
- **Gregorian input:** the complaint incident date (services.new.tsx:574) and the revenue filters
  (revenue.index.tsx:344, :348).
- **Public QR verification:** `/v/$token` shows issue date, expiry date and date of birth as Gregorian ISO strings
  (v.$token.tsx:302-305). The printed card shows EC dates, so the verification page and the card show different
  dates for the same event.

### WP-LOC-005 — Phone and FAN formats are validated only in the browser (Medium, Residents; also C-06)

On the client, Zod requires a 16-digit FAN (residentSchema.ts:41) and a 9-digit local phone number
(phoneNumber.ts:59, woreda-configuration.tsx:94). On the server:

- None of the 90 migrations adds a CHECK constraint on any phone or national-ID column.
- The latest `resident_pii_sync()` (migration 44) encrypts and blind-indexes whatever it receives.
- `normalize_phone()` passes through any digit string it does not recognise.

A direct PostgREST write can therefore store `national_id_no = 'ABC'`, which defeats duplicate-FAN detection. The
client regex also accepts `000000000`. This contradicts docs/security-functionality.md's claim that the client and
database layers are "consistently applied".

**Fix:** validate the format in the BEFORE INSERT/UPDATE PII trigger, before encryption, and tighten the client
regex to match.

### WP-LOC-006 — Dashboard monthly chart: Gregorian buckets with EC labels (Low)

Registrations are grouped by Gregorian month, but each bar is labelled with the EC month that contains today's
day-of-month (dashboard.tsx:374-390). The label changes on the 11th of each month. From 6 to 10 September the
September bar reads "ጳጉሜ". Using `setMonth()` on the 29th–31st can also skip or duplicate a bucket.

### WP-LOC-007 — Font application gaps (Low, confidence Likely)

The fonts are present, and each stack is ordered with its Ethiopic face first and Noto as fallback: Tayitu→Noto for
headings (75 uses) and Jiret→Noto for body text (980 uses). The gaps:

- Amharic text without a font class falls through the body default, Inter. The `:lang(am)` rule is dead because
  `lang="am"` is never set (WP-BQ-005).
- The receipt, the ID-card print surface and both canvas PDF exporters hard-code Noto Sans Ethiopic.
- Only Regular font files ship, but each face declares `font-weight: 400 700`. The browser will probably treat that
  one file as covering bold and not synthesise bold.

The owner's "Tayitu primary / Jiret secondary" is implemented as "Tayitu for headings, Jiret for body", which
matches the recorded licence decision. The owner should confirm this reading.

### WP-LOC-008 — EthiopianDateInput silently keeps the old value (Low)

`commit()` simply returns on incomplete or invalid input, such as Pagume 6 in a common year (lines 58-65). The form
keeps the previous date while the fields show the new one, and an optional date cannot be cleared.

**Fix:** emit `""` and show an inline bilingual error, and cap the day input at 5 or 6 when Pagume is selected.

### WP-LOC-009 — No approved Amharic source (Low)

`docs/amharic-strings-glossary.csv` has 693 rows and was last changed on 2026-09-14. It is an extraction from the
code, not an approved source, and native sign-off is recorded as pending (go-live-declaration.md:310). It is also
stale:

- 1,065 of 1,749 Ethiopic runs in `src/` are not in it, 204 of them in rental files.
- The 193 Amharic lines in migrations are outside it entirely.

Spellings are inconsistent: ኃይማኖት/ሃይማኖት, ፆታ/ጾታ, ንኡስ/ንዑስ. Whether the strings are verbatim from an approved
source is UNVERIFIED until a native speaker reviews them. English-only toasts are already covered by WP-BQ-006.

### WP-LOC-010 — Name structure enforced only in the UI (Low)

The forms require first + father + grandfather names and compose `full_name_am` in that order. No last-name or
surname fields exist anywhere. However:

- The database leaves `first_name`, `father_name` and `grandfather_name` nullable (baseline.sql:357-367).
- The English name is a single free-text `full_name`.
- There is no short-name helper (first + father).

### WP-LOC-011 — Document numbers use the Gregorian year (Low)

All nine numbering triggers use `EXTRACT(YEAR FROM NOW()) % 100` in their latest definitions. A receipt issued on
14 መስከረም 2019 is numbered `…-RCT-26-…`, and the sequences reset on 1 January UTC. The owner should either document
this as deliberate or move the non-credential numbers to the EC year. The credential number's format is locked by
the barcode and Luhn invariants.

### WP-LOC-012 — "Today" is the UTC date (Low)

`new Date().toISOString().slice(0,10)` is used for:

- civil `registration_date` defaults and the "cannot be in the future" checks
- rent `_payment_date`
- the offline-replay payment date (offlineSync.ts:241)
- the reports `TODAY` constant, which is also computed once at module load

From 00:00 to 03:00 EAT all of these resolve to the previous day.

### WP-LOC-013 — No Gott level (Info)

Kebele is reference-only, as required: it carries no role, permission or RLS scope. There is, however, no Gott (ጎጥ)
level in the schema. Households and residents record a free-text "Sub-Woreda / ንዑስ ወረዳ" instead.

### WP-LOC-014 — Jineala's Amharic spelling (Info)

The README has ጂናኤላ; the seed has ጂንኤላ (seed.sql:74). Everything else in the woreda and kebele mapping matches
exactly.

## Drift (docs vs code)

| Claim | Source | Verdict |
|---|---|---|
| Exact JDN-based EC conversion | CLAUDE.md | CONFIRMED |
| EC-first dates; input via `<EthiopianDateInput>` | CLAUDE.md, portal-conventions-review agent | CONTRADICTED |
| ALL woreda dates EC-primary | README.md:44 | CONTRADICTED |
| Tayitu/Jiret replaced `.font-noto-ethiopic` | CLAUDE.md | CONTRADICTED (3 class uses + 26 inline Noto remain) |
| Both fonts fall back to loaded Noto | styles.css:8-14 | CONFIRMED |
| Woreda IDs 1–6, 19-kebele mapping | README.md:50-59 | CONFIRMED (Jineala Amharic spelling differs) |
| 19 kebeles / no kebele-level actor | docs/system-review-2026-09.md:117 | CONFIRMED |
| Only four translateError entries carry Amharic | CLAUDE.md | CONFIRMED |
| Amharic sign-off not complete | go-live-declaration.md:310 | CONFIRMED |
| Zod + DB CHECK "consistently applied" | security-functionality.md:34-60 | CONTRADICTED for phone/FAN |
| Every stored phone is +251 + 9 digits | phoneNumber.ts:4-9 | CONTRADICTED (UI writes only) |
| HistoryTimeline fixes Gregorian display | HistoryTimeline.tsx:81-84 | CONFIRMED (the clock is still Western) |
| Pagume is never billed | ethiopianCalendar.ts:207-209 | CONFIRMED (mig 76 CHECK 1–12) |

## Limits

- The Section-3 brief is not in the repository, so ET-11 was compared against README.md's spec table, the only copy
  in the repo.
- The live database was not reachable. Seed values and CHECK constraints were read from files only.
- Whether the Amharic is verbatim and correct needs native-speaker review.
- The time bands for ጠዋት/ቀትር/ማታ/ለሊት beyond the four anchor points given in the checklist need confirmation from
  the owner.
