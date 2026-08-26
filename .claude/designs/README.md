# Design Files

This directory contains design specifications and assets for the woreda portal, organized by feature area.

## woreda-documents/

Claude Design Canvas files (.dc.html) for printable A4 documents used in the woreda portal. These documents include:

- **Resident Profile.dc.html** — Printable resident identity and biographical information
- **Household Profile.dc.html** — Printable household registration form
- **Kebele Rental House Occupant Profile.dc.html** — Printable rental occupant registration
- **Service Request Letter.dc.html** — Printable letter template for service requests

### Using These Files

These are interactive design files that open in Claude Design Canvas (claude.ai/code). They show:
- A4 page layout at 1:1 scale
- Live preview with real data placeholders
- Bilingual (Amharic/English) labels and content
- Letterhead, signature blocks, and verification footers

### Files Included

- `*.dc.html` — Design canvas files (open in Claude Code)
- `_ds/` — Design system assets (Modernist design system colors, typography)
- `doc-page.js` — Custom element for A4 page rendering
- `image-slot.js` — Custom element for photo/image placeholders
- `support.js` — Shared canvas utilities

### Editing

To edit a design file:
1. Open it in Claude Code: `/designs/woreda-documents/[filename].dc.html`
2. The design canvas editor loads with live preview
3. Click to select elements, adjust layout, edit text
4. Save publishes the updated version (if saving is enabled)

### Integrating with Routes

Print routes (e.g., `src/routes/woreda.credentials.$requestId.print.tsx`) consume these designs:

1. Import the design file or its HTML content
2. Query data from the database (residents, households, services, etc.)
3. Use `document.querySelector()` or `image-slot` API to bind live data to placeholders
4. Render in the browser and let users print to PDF via browser print dialog

For implementation details, see `.claude/skills/document-designs/SKILL.md`.

### Design System Reference

All documents use the **Modernist design system** (colors, typography, spacing conventions). Update `_ds/` only when the base design system changes across all woreda-facing documents.

See `.claude/skills/document-designs/SKILL.md` for conventions on:
- Bilingual labels (Amharic / English)
- Section structure and numbering
- Image slots and photo handling
- Signature and certification blocks
- Verification footers and document IDs
