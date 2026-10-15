import { describe, expect, it } from "vitest";

import { buildCertificatePdf, PREVIEW_WATERMARK } from "@/lib/certificatePdf";

// 1x1 white PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";

describe("buildCertificatePdf", () => {
  it("produces a single A4 landscape page", () => {
    const pdf = buildCertificatePdf(PNG, { title: "Birth Certificate X", preview: false });
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(Math.round(pdf.internal.pageSize.getWidth())).toBe(297);
    expect(Math.round(pdf.internal.pageSize.getHeight())).toBe(210);
  });

  it("stamps a preview as not valid, and never stamps the issued copy", () => {
    const preview = buildCertificatePdf(PNG, { title: "T", preview: true }).output();
    const issued = buildCertificatePdf(PNG, { title: "T", preview: false }).output();
    expect(preview).toContain(PREVIEW_WATERMARK);
    expect(issued).not.toContain(PREVIEW_WATERMARK);
  });
});
