import { describe, expect, it } from "vitest";

import {
  CERTIFICATE_FIELDS,
  CERTIFICATE_TYPES,
  FIELD_GROUPS,
  formatDateValue,
  formatsFor,
  renderFieldText,
  splitEthiopianName,
  certificateField,
} from "@/config/certificateFields";
import {
  certificatePrefill,
  missingInputs,
  resolveCertificateValues,
  type CertificateContext,
} from "@/lib/certificateData";

const event = (over: Partial<CertificateContext["event"]> = {}): CertificateContext["event"] => ({
  event_type: "birth",
  event_number: "BR-2017-000123",
  event_date: "2025-01-20",
  registration_date: "2025-01-25",
  issued_at: null,
  event_details: {},
  ...over,
});

const ctx = (over: Partial<CertificateContext> = {}): CertificateContext => ({
  event: event(),
  registrar: { full_name: "አበበ ከበደ ተሰማ", signature_path: "w1/sig.webp" },
  woreda: { name_am: "ጀጎል ወረዳ", name_en: "Jugol Woreda", stamp_path: "w1/stamp.webp" },
  printedOn: "2025-02-01",
  ...over,
});

describe("certificate catalog", () => {
  it("covers all five certificates, with unique keys and known groups", () => {
    const groups = new Set(FIELD_GROUPS.map((g) => g.key));
    for (const t of CERTIFICATE_TYPES) {
      const keys = CERTIFICATE_FIELDS[t].map((x) => x.key);
      expect(new Set(keys).size, t).toBe(keys.length);
      for (const field of CERTIFICATE_FIELDS[t]) {
        expect(groups.has(field.group), `${t}.${field.key}`).toBe(true);
        expect(field.am.trim(), `${t}.${field.key} am`).not.toBe("");
        expect(field.en.trim(), `${t}.${field.key} en`).not.toBe("");
      }
    }
  });

  it("carries every field listed in the certificate specification", () => {
    const must: Record<string, string[]> = {
      birth: [
        "register_form_no",
        "registration_uid",
        "child_name",
        "child_father_name",
        "child_grandfather_name",
        "child_sex",
        "child_date_of_birth",
        "child_birth_place",
        "child_region",
        "child_zone",
        "child_woreda",
        "child_nationality",
        "mother_full_name",
        "mother_nationality",
        "father_full_name",
        "father_nationality",
        "registration_date",
        "certificate_issued_date",
        "registrar_name",
        "registrar_father_name",
        "registrar_grandfather_name",
        "registrar_signature",
        "seal",
      ],
      death: [
        "deceased_birth_reg_uid",
        "deceased_name",
        "deceased_title",
        "deceased_sex",
        "deceased_date_of_birth",
        "deceased_nationality",
        "place_of_death",
        "date_of_death",
      ],
      marriage: [
        "wife_birth_reg_uid",
        "husband_birth_reg_uid",
        "wife_name",
        "husband_name",
        "wife_date_of_birth",
        "husband_nationality",
        "date_of_marriage",
        "marriage_place",
        "marriage_region",
        "marriage_zone",
        "marriage_city",
        "marriage_subcity",
        "marriage_woreda",
        "marriage_kebele",
      ],
      divorce: [
        "party1_birth_reg_uid",
        "party2_birth_reg_uid",
        "party1_name",
        "party2_grandfather_name",
        "party1_birth_place",
        "party2_region",
        "party1_zone",
        "party2_nationality",
        "date_of_divorce",
        "divorce_place",
      ],
      adoption: [
        "adoptee_birth_reg_uid",
        "adoptee_name",
        "adoptee_sex",
        "adoptee_date_of_birth",
        "adoptee_birth_place",
        "adoptee_region",
        "adoptee_zone",
        "mother_full_name",
        "father_nationality",
      ],
    };
    for (const [t, keys] of Object.entries(must)) {
      for (const k of keys) {
        expect(certificateField(t as "birth", k), `${t}.${k}`).toBeDefined();
      }
    }
  });

  it("puts a verification QR and code on every certificate", () => {
    for (const t of CERTIFICATE_TYPES) {
      expect(certificateField(t, "verification_qr")?.kind, t).toBe("qr");
      expect(certificateField(t, "verification_code")?.source, t).toBe("certificate_token");
    }
  });

  it("offers the right formats per kind", () => {
    expect(formatsFor("bilingual")).toEqual(["am", "en", "am_en"]);
    expect(formatsFor("date")).toContain("ec_full");
    expect(formatsFor("date")).toContain("gc_year");
    expect(formatsFor("image")).toEqual(["image"]);
  });
});

describe("date formatting", () => {
  it("prints Ethiopian dates with Arabic numerals and Amharic month names", () => {
    // 2025-01-20 is 12 Tir 2017 E.C.
    expect(formatDateValue("2025-01-20", "ec_full")).toBe("12 ጥር 2017 ዓ.ም");
    expect(formatDateValue("2025-01-20", "ec_day")).toBe("12");
    expect(formatDateValue("2025-01-20", "ec_month")).toBe("ጥር");
    expect(formatDateValue("2025-01-20", "ec_year")).toBe("2017");
    expect(formatDateValue("2025-01-20", "ec_full")).not.toMatch(/[፩-፼]/);
  });
  it("prints Gregorian dates in English", () => {
    expect(formatDateValue("2025-01-20", "gc_full")).toBe("January 20, 2025");
    expect(formatDateValue("2025-01-20", "gc_month")).toBe("January");
  });
  it("is empty for a missing or malformed date", () => {
    expect(formatDateValue(null, "ec_full")).toBe("");
    expect(formatDateValue("not-a-date", "gc_full")).toBe("");
  });
});

describe("splitEthiopianName", () => {
  it("splits First / Father / Grandfather", () => {
    expect(splitEthiopianName("አበበ ከበደ ተሰማ")).toEqual(["አበበ", "ከበደ", "ተሰማ"]);
    expect(splitEthiopianName("Abebe  Kebede")).toEqual(["Abebe", "Kebede", ""]);
    expect(splitEthiopianName("A B C D")).toEqual(["A", "B", "C D"]);
    expect(splitEthiopianName(null)).toEqual(["", "", ""]);
  });
});

describe("resolveCertificateValues", () => {
  it("reads captured inputs, event columns, registrar and seal", () => {
    const c = ctx({
      event: event({
        event_details: {
          certificate: {
            register_form_no: "F-77",
            child_name_am: "ሰላም",
            child_name_en: "Selam",
            child_sex: "female",
          },
        },
      }),
    });
    const v = resolveCertificateValues("birth", c);
    expect(v.register_form_no.text).toBe("F-77");
    expect(v.registration_uid.text).toBe("BR-2017-000123");
    expect(v.child_name).toEqual({ am: "ሰላም", en: "Selam" });
    // falls back to the event date when no birth date was captured
    expect(v.child_date_of_birth.date).toBe("2025-01-20");
    expect(v.registration_date.date).toBe("2025-01-25");
    expect(v.certificate_issued_date.date).toBe("2025-02-01");
    expect(v.registrar_name.am).toBe("አበበ");
    expect(v.registrar_father_name.am).toBe("ከበደ");
    expect(v.registrar_grandfather_name.am).toBe("ተሰማ");
    expect(v.registrar_signature.image).toBe("w1/sig.webp");
    expect(v.seal.image).toBe("w1/stamp.webp");
    expect(v.issuing_woreda.en).toBe("Jugol Woreda");
  });

  it("renders each kind through its format", () => {
    const v = resolveCertificateValues(
      "birth",
      ctx({
        event: event({
          event_details: { certificate: { child_name_am: "ሰላም", child_sex: "female" } },
        }),
      }),
    );
    const name = certificateField("birth", "child_name")!;
    const sex = certificateField("birth", "child_sex")!;
    expect(renderFieldText(name, v.child_name, "am")).toBe("ሰላም");
    // English requested but not captured: falls back to Amharic rather than printing a blank
    expect(renderFieldText(name, v.child_name, "en")).toBe("ሰላም");
    expect(renderFieldText(sex, v.child_sex, "am_en")).toBe("ሴት / Female");
  });
});

describe("certificatePrefill", () => {
  it("seeds the birth card from the existing birth form keys without overwriting input", () => {
    const e = event({
      event_details: {
        child_first_name: "ሰላም",
        child_father_name: "ዳዊት",
        child_full_name_en: "Selam Dawit Alemu",
        sex: "female",
        mother_name: "ሄለን ታደሰ",
        certificate: { child_father_name_am: "already typed" },
      },
    });
    const p = certificatePrefill("birth", e);
    expect(p.child_name_am).toBe("ሰላም");
    expect(p.child_father_name_am).toBeUndefined();
    expect(p.child_grandfather_name_en).toBe("Alemu");
    expect(p.child_sex).toBe("female");
    expect(p.mother_full_name_am).toBe("ሄለን ታደሰ");
  });

  it("assigns wife and husband only from a linked resident's sex", () => {
    const res = (sex: string, first: string) => ({
      first_name: first,
      father_name: "F",
      grandfather_name: "G",
      full_name: null,
      full_name_am: null,
      sex,
      date_of_birth: "1990-05-01",
      birth_place: null,
      mother_full_name: null,
    });
    const e = event({
      event_type: "marriage",
      event_details: { spouse1: { name: "x" }, spouse2: { name: "y" } },
    });
    const p = certificatePrefill("marriage", e, {
      party1: res("male", "ባል"),
      party2: res("female", "ሚስት"),
    });
    expect(p.wife_name_am).toBe("ሚስት");
    expect(p.husband_name_am).toBe("ባል");
    expect(p.wife_date_of_birth).toBe("1990-05-01");
    // no linked residents: no guess
    const q = certificatePrefill("marriage", e);
    expect(q.wife_name_am).toBeUndefined();
  });

  it("lists the inputs still missing", () => {
    const missing = missingInputs("death", { deceased_name_am: "x" }).map((x) => x.key);
    expect(missing).not.toContain("deceased_name");
    expect(missing).toContain("deceased_title");
    expect(missing).not.toContain("registration_uid");
  });
});
