import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CertificatePage } from "@/components/certificates/CertificatePage";
import type { PlacedField } from "@/components/certificates/certificateLayout";
import { resolveCertificateValues } from "@/lib/certificateData";

const placed = (over: Partial<PlacedField>): PlacedField => ({
  certificate_field_id: Math.random().toString(36).slice(2),
  certificate_type: "birth",
  field_key: "child_name",
  format: "am",
  binding_mode: "data",
  static_value: null,
  x: 10,
  y: 10,
  width: 30,
  height: 4,
  font_size: 12,
  font_weight: "normal",
  font_style: "normal",
  text_align: "left",
  color: "#000000",
  font_family: "Tayitu",
  z_index: 1,
  ...over,
});

const values = resolveCertificateValues("birth", {
  event: {
    event_type: "birth",
    event_number: "HR-BR-25-000001",
    event_date: "2025-01-20",
    registration_date: "2025-01-25",
    issued_at: null,
    event_details: { certificate: { child_name_am: "ሰላም", child_name_en: "Selam" } },
  },
  registrar: { full_name: "አበበ ከበደ ተሰማ", signature_path: null },
  woreda: { name_am: "ጀጎል", name_en: "Jugol", stamp_path: null },
  printedOn: "2025-02-01",
});

describe("CertificatePage", () => {
  it("prints resolved values in the placed format", () => {
    render(
      <CertificatePage
        type="birth"
        orientation="portrait"
        backgroundUrl={null}
        values={values}
        fields={[
          placed({ field_key: "child_name", format: "en" }),
          placed({ field_key: "child_date_of_birth", format: "ec_full" }),
          placed({ field_key: "registration_uid", format: "plain" }),
          placed({ field_key: "registrar_father_name", format: "am" }),
          placed({
            binding_mode: "static",
            field_key: "static_text",
            format: "plain",
            static_value: "ፌዴራላዊ",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Selam")).toBeTruthy();
    expect(screen.getByText("12 ጥር 2017 ዓ.ም")).toBeTruthy();
    expect(screen.getByText("HR-BR-25-000001")).toBeTruthy();
    expect(screen.getByText("ከበደ")).toBeTruthy();
    expect(screen.getByText("ፌዴራላዊ")).toBeTruthy();
  });

  it("shows bilingual labels in design mode (no values)", () => {
    render(
      <CertificatePage
        type="birth"
        orientation="landscape"
        backgroundUrl={null}
        values={null}
        fields={[placed({ field_key: "mother_full_name" })]}
      />,
    );
    expect(screen.getByText("የእናት ሙሉ ስም / Mother's Full Name")).toBeTruthy();
  });

  it("renders captured text as text, never as markup", () => {
    const v = resolveCertificateValues("birth", {
      event: {
        event_type: "birth",
        event_number: null,
        event_date: null,
        registration_date: null,
        issued_at: null,
        event_details: { certificate: { child_name_am: "<img src=x onerror=alert(1)>" } },
      },
      registrar: null,
      woreda: null,
      printedOn: "2025-02-01",
    });
    const { container } = render(
      <CertificatePage
        type="birth"
        orientation="portrait"
        backgroundUrl={null}
        values={v}
        fields={[placed({ field_key: "child_name" })]}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});
