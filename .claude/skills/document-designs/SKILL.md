# Document Designs

Manage printable A4 documents for the woreda portal: Resident Profile, Household Profile, Kebele Rental House Occupant Profile, and Service Request Letter. These are Claude Design Canvas files (.dc.html) with bilingual (Amharic/English) layouts, letterhead, field sets, document numbering, and verification-code footers.

## Document Map

| Design File | Purpose | Repo Route(s) | Data Model |
|---|---|---|---|
| **Resident Profile.dc.html** | Printable resident identity card | `woreda.credentials.$requestId.print.tsx` | `residents` table, credential data |
| **Household Profile.dc.html** | Printable household registration | `woreda.households.$householdId.index.tsx` | `households` table, household members |
| **Kebele Rental House Occupant Profile.dc.html** | Printable rental occupant form | `woreda.rental-houses.$houseId.index.tsx`, `woreda.rental-houses.occupants.new.tsx` | `rental_houses`, `rental_house_occupants` |
| **Service Request Letter.dc.html** | Printable letter for service requests | `woreda.services.$requestId.print.tsx` | `service_requests`, `service_types`, `letter_template` |

## Print Document Conventions

### Design System
- Design system: **Modernist** (Harari brand colors, typography)
- Page size: **A4** with 0.6-inch margins
- Document layout: **HTML/CSS with semantic sections** (fieldsets)

### Bilingual Labels
- **Amharic first**, English second in format: `"ስም / Name"` or `"ሙሉ ስም <span style="opacity:.65;">Full Name</span>"`
- Amharic heading labels in bold accent color
- English translations in lighter weight, secondary color
- Label hierarchy: `<h6 style="color:var(--color-accent-700);margin-bottom:14px;">01 — ማንነት <span style="font-size:10px;font-weight:400;opacity:.55;">Identity</span></h6>`

### Document Structure
1. **Letterhead**: Logo (56×56px), ministry/woreda title, document type tag, document number, issue date
2. **Sections**: Numbered fieldsets (01, 02, 03, 04) with bilingual headers
3. **Data grids**: Field labels + values, typically 2–3 columns
4. **Signature block**: 3-column layout with signature lines and official stamp
5. **Verification footer**: Document ID, verification URL (e.g., `portal.harariadmin.gov.et/verify`), print date
6. **Footer text**: System attribution and language (Amharic/English)

### Photo & Image Slots
- Use `<image-slot>` custom element with:
  - `id="unique-id"` (e.g., `logo-resident-profile`)
  - `shape="rect"` (rectangular, not rounded)
  - `radius="0"` (no border radius for photos)
  - `placeholder="ፎቶ · Photo"` (bilingual placeholder)
  - Fixed dimensions in `style` (e.g., `width:132px;height:164px`)
- Wrap in `.grayscale` div for desaturated preview

### Color & Spacing
- Accent color for section headers: `var(--color-accent-700)`
- Dividers: `var(--color-divider)`
- Text opacity for secondary labels: `opacity:.55` to `.6`
- Section spacing: 22px margins between sections, 18–24px grid gaps
- Line-height for headings: compact (6px margin top)

### Document Numbering
- Format: `ABK/RES/2018/0934` (Aboker Woreda / Document Type / Year / Sequence)
- Displayed in letterhead right-column: `ቁ. <strong>ABK/RES/2018/0934</strong>`
- Include in verification footer for audit trail

### Signature & Certification
- **Signature lines**: 1px border-top, left-aligned text label
- **Spacing**: 44px margin-top to clear handwriting space
- **Stamp box**: 1px border rect, min-height 74px, centered placeholder text
- **Layout**: 3-column grid, signature–signature–stamp

### Verification Footer
- Background: Light border (1px `var(--color-divider)`)
- Padding: 10px 14px
- Content: Document ID + verification URL + print date
- Font size: 10.5px, secondary text at 9.5px
- URL pattern: `portal.harariadmin.gov.et/verify` (no token in markup; token appended by print route)

## Implementation in Routes

### Print Route Pattern
```tsx
// src/routes/woreda.credentials.$requestId.print.tsx
export const Route = createFileRoute('/woreda/credentials/$requestId/print')({
  ssr: false,
  component: CredentialPrint,
});

function CredentialPrint() {
  // Fetch data
  // Render from design file (imported as HTML or via iframe)
  // Photo slots filled from database URLs
  // Document number/date from `residence_credential` row
}
```

### Data-to-Design Binding
- Design files use **placeholder data** for all dynamic fields
- Print routes fetch live data and **replace placeholders** via:
  - `querySelector` + `textContent` for text fields
  - `image-slot` API for photos (set `src` via `setSrc()` or similar)
  - Query params or state to pass document ID
- **No hardcoded design files in routes**: import at build time or fetch as HTML templates

## Editing Guidelines

### When to Update
- Color scheme changes → regenerate from design system
- New fields added to a data model → add row to the corresponding section grid
- Letterhead changes (ministry name, contact) → update `<h1>` and contact info once, test across all four documents
- Verification URL or format changes → batch update all four verification footers

### Adding a New Field
1. Locate the appropriate section (`01 — ማንነት`, `02 — አድራሻ`, etc.)
2. Add a `<div>` with the label pattern: `<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb, var(--color-text) 55%, transparent);margin-bottom:3px;">የሰም ምሳሌ <span style="opacity:.65;">Example Field</span></div>`
3. Add value `<div>` below: `<div style="font-size:15px;font-weight:600;">placeholder value</div>`
4. Adjust grid `grid-template-columns` (e.g., `repeat(3,1fr)` for 3 columns) if needed

### Before Publishing
- Test print preview in browser (Chrome → Print, save as PDF)
- Verify all text fits within A4 page bounds
- Check placeholder data is realistic (no typos or test values)
- Confirm bilingual labels read consistently across all documents

## Troubleshooting

**Photo or image not showing**: Ensure `image-slot` has an `id` and matching data binding in the print route. Check file format (JPG/PNG) and size (< 2MB).

**Text overflow**: Reduce font size or grid column span. Preview in print mode to see actual page bounds.

**Design system not loading**: Verify `_ds/modernist-*` folder is included and CSS/JS paths in `<helmet>` are correct relative to the HTML file.

**Verification URL wrong**: Search all four files for `portal.harariadmin.gov.et/verify` and update in one place if centralizing.
