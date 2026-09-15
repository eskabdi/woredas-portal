# Reconciliation memo — governing brief vs. as-built system

**Purpose.** `docs/system-review-2026-09.md` §0 ("Correction to the stated ground
truth") found six places where the original review brief that scoped that
audit asserts something the as-built system does not do. The review
classified this as documentation drift (finding F-14, Low severity, not a
defect) but flagged it as something that "must be corrected before the brief
is reused for accreditation." This memo is that correction, re-verified
against the current `main` (2026-09-14, post Task 12-C) rather than the
2026-09-07 commit the original review read.

**Scope of "the brief."** The brief itself is an external document supplied
to scope the 2026-09 review — it is not checked into this repository, so this
memo cannot edit it directly. What this repository _can_ do, and now does, is
carry the authoritative correction in two places: this memo (a
handoff-ready record for whoever maintains the brief externally) and
`docs/architecture.md` §"Corrections to the governing brief" (so the
correction lives alongside the system's other structural documentation, not
only in a point-in-time review artifact).

**Disposition.** All six items are re-verified true as-built below. None is a
defect; each is a deliberate, documented engineering decision. The brief's
assertion is what should be edited or annotated wherever it is maintained.

| #   | Brief asserts                                                                        | As-built (re-verified 2026-09-14)                                                                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | QR signed with **RS256**                                                             | **ES256** (ECDSA P-256)                                                                                               | `src/config/credentialCryptoConfig.ts:2,9` — the file's own header comment states the reason: a 64-byte ECDSA signature vs. RS256's 256-byte signature is what keeps the QR under printable module density at 300dpi on an 85.6×54mm card (see `docs/id-card-workflow.txt` and `src/utils/barcode.ts`'s density guard for the same constraint applied to the barcode).                                                                                                                                                                                                                                     |
| 2   | Credential number `WW-KK-YY-NNNNNN-C`, **mod-11** check digit                        | **13 digits, standard Luhn (mod-10)**                                                                                 | `supabase/migrations/00000000000002_credential.sql:5-7,16-33,116` — the migration's own header comment records the change explicitly: "The credential number's check digit moves from a bespoke mod-11 scheme to standard Luhn... The 13-digit length of that number becomes an enforced invariant." Pre-existing credentials numbered under the old scheme were unsigned and unprinted at the time and were renumbered (same migration, lines 124-125).                                                                                                                                                   |
| 3   | `safeBase64Encode`/`safeBase64Decode` **mandatory**                                  | **Do not exist under those names.** Byte-level `atob`/`btoa` paired with `TextEncoder`/`TextDecoder` are used instead | `src/utils/harariCredentialCrypto.ts:99-110,158`, `supabase/functions/sign-credential/index.ts` — grepped the full `src/` and `supabase/` trees for `safeBase64`: zero matches. The specific hazard the brief's naming implies (`btoa(unicodeString)` corrupting non-ASCII, e.g. Amharic, content) does not occur here because every `atob`/`btoa` call site operates on already-byte-decoded data (`Uint8Array ↔ base64`), with `TextEncoder`/`TextDecoder` doing the UTF-8 boundary conversion separately — the review's own KD-2 finding confirms this is a naming divergence, not a missing safeguard. |
| 4   | Revenue, Reporting, and Audit UI, and the ID-card template editor, **not yet built** | **All built and routed**                                                                                              | `src/routes/woreda.revenue.tsx`, `woreda.revenue.index.tsx`, `woreda.revenue.$paymentId.receipt.tsx`; `woreda.reports.tsx`, `woreda.reports.index.tsx`, `woreda.reports.$reportType.print.tsx`; `woreda.audit.tsx`; `admin.credential-template.tsx` — all present and permission-gated as of this memo's date, unchanged in status since the original review.                                                                                                                                                                                                                                              |
| 5   | Data-Flow Diagram / Security Functionality Document **missing**                      | **Present**                                                                                                           | `docs/dfd.md`, `docs/security-functionality.md`, `docs/erd.md`, `docs/openapi.yaml` — all four exist, and as of Task 8 (this PR) `erd.md`/`security-functionality.md`/`openapi.yaml` were regenerated from a live, read-only enumeration of the production schema rather than only from migration files.                                                                                                                                                                                                                                                                                                   |
| 6   | QR payload budget **~1.8 KB**                                                        | Design budget is **~500 characters**                                                                                  | `supabase/functions/sign-credential/index.ts:7-13` — the function's own header comment states the actual constraint: single-character keys and `YYYYMMDD` dates are chosen specifically because "a payload that grows past ~500 characters pushes the QR into a version [density] this printer cannot resolve" — a far tighter, printer-resolution-driven budget than 1.8 KB, not a looser one.                                                                                                                                                                                                            |

## Why this matters beyond documentation hygiene

An auditor working from the unreconciled brief would raise six findings that
do not describe this system: a wrong signature algorithm, a wrong check-digit
scheme, a missing safety wrapper that was never needed because the actual
implementation avoids the hazard a different way, three "not built" claims
about modules that have been live since before the review, and a QR budget
number pointing at the wrong constraint entirely — which would misdirect any
follow-up remediation toward fixing things that already work and away from
the review's own genuinely correct findings (the workflow-transition-guard
defect and the twelve lesser findings the same review actually substantiates
correctly).

## Recommended action on the brief itself

Since the brief lives outside this repository, the recommended action is one
of:

1. Replace the brief's six assertions with the "as-built" column of the table
   above, citing this memo and `docs/architecture.md`'s corresponding
   section as the source, or
2. If the brief cannot be edited (e.g. it is a fixed compliance-template
   input), attach this memo as a formal addendum/errata sheet whenever the
   brief is submitted for accreditation, so a reviewer reading the brief
   alone is directed here before treating any of the six items as a live
   finding.

This memo does not itself change any code, schema, or configuration — per
Task 8's own read-only-for-regeneration guardrail, it is a documentation
correction only.
