/**
 * Civil-registration certificate field catalog.
 *
 * One place that defines, for each of the five certificates (birth, death,
 * marriage, divorce, adoption):
 *   - every field the printed certificate carries, grouped the way the
 *     template builder's palette shows them;
 *   - its Amharic and English label;
 *   - its kind (bilingual text, date, sex, plain text, image), which decides
 *     the formats a placed template field can choose (am / en, Ethiopian or
 *     Gregorian date, a single day / month / year box, ...);
 *   - where its value comes from: captured on the event's "Certificate
 *     details" card (event_details.certificate), or derived from the event,
 *     the registrar or the woreda.
 *
 * The super-admin template builder (admin.certificate-templates.tsx), the
 * capture card (CertificateDetailsCard) and the print route
 * (woreda.civil.$eventId.certificate.tsx) all read this file, so a field
 * exists in exactly one place. Dates follow the house rule: stored
 * Gregorian, shown Ethiopian with Arabic numerals.
 */
import {
  ETHIOPIAN_MONTHS_AM,
  gregorianToEthiopian,
  parseStoredDate,
} from "@/utils/ethiopianCalendar";

export const CERTIFICATE_TYPES = ["birth", "death", "marriage", "divorce", "adoption"] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export const CERTIFICATE_TYPE_LABELS: Record<CertificateType, { am: string; en: string }> = {
  birth: { am: "የልደት የምስክር ወረቀት", en: "Birth Certificate" },
  death: { am: "የሞት የምስክር ወረቀት", en: "Death Certificate" },
  marriage: { am: "የጋብቻ የምስክር ወረቀት", en: "Marriage Certificate" },
  divorce: { am: "የፍቺ የምስክር ወረቀት", en: "Divorce Certificate" },
  adoption: { am: "የጉዲፈቻ የምስክር ወረቀት", en: "Adoption Certificate" },
};

export type FieldGroup = "identifiers" | "applicant" | "spouse_parents" | "event" | "registrar";

export const FIELD_GROUPS: { key: FieldGroup; am: string; en: string }[] = [
  { key: "identifiers", am: "መለያ ቁጥሮች", en: "Identifiers" },
  { key: "applicant", am: "የአመልካች መረጃ", en: "Applicant Details" },
  { key: "spouse_parents", am: "የተጋቢ / የወላጆች መረጃ", en: "Spouse / Parents Details" },
  { key: "event", am: "የኩነቱ መረጃ (ቀን / ቦታ)", en: "Event Details (Date / Place)" },
  { key: "registrar", am: "የመዝጋቢ መረጃ", en: "Registrar Details" },
];

/**
 * bilingual: captured as `<key>_am` and `<key>_en`.
 * text:      one value, shown as typed (form numbers, ID numbers).
 * date:      ISO yyyy-mm-dd, printable in Ethiopian or Gregorian form.
 * sex:       "male" | "female", printed in Amharic or English.
 * image:     a storage path (registrar signature, woreda seal).
 */
export type FieldKind = "bilingual" | "text" | "date" | "sex" | "image";

/**
 * input:     captured on the event's Certificate details card.
 * event_*:   the vital_event row itself.
 * registrar_*, woreda_*, seal: resolved at print time.
 */
export type FieldSource =
  | "input"
  | "event_number"
  | "event_date"
  | "registration_date"
  | "issued_date"
  | "registrar_name"
  | "registrar_father_name"
  | "registrar_grandfather_name"
  | "registrar_signature"
  | "seal"
  | "woreda_name";

export interface CertificateField {
  key: string;
  group: FieldGroup;
  am: string;
  en: string;
  kind: FieldKind;
  source: FieldSource;
  /** For a date the event row also carries: used when nothing was captured. */
  fallback?: FieldSource;
}

const f = (
  key: string,
  group: FieldGroup,
  am: string,
  en: string,
  kind: FieldKind,
  source: FieldSource = "input",
  fallback?: FieldSource,
): CertificateField => ({ key, group, am, en, kind, source, fallback });

/** Name / Father's name / Grandfather's name -- Ethiopian three-part names. */
function personName(prefix: string, group: FieldGroup, whoAm: string, whoEn: string) {
  return [
    f(`${prefix}_name`, group, `${whoAm} ስም`, `${whoEn} Name`, "bilingual"),
    f(`${prefix}_father_name`, group, `${whoAm} የአባት ስም`, `${whoEn} Father's Name`, "bilingual"),
    f(
      `${prefix}_grandfather_name`,
      group,
      `${whoAm} የአያት ስም`,
      `${whoEn} Grandfather's Name`,
      "bilingual",
    ),
  ];
}

function common(type: CertificateType): {
  head: CertificateField[];
  tail: CertificateField[];
} {
  const t = CERTIFICATE_TYPE_LABELS[type];
  const regAm: Record<CertificateType, string> = {
    birth: "የልደት",
    death: "የሞት",
    marriage: "የጋብቻ",
    divorce: "የፍቺ",
    adoption: "የጉዲፈቻ",
  };
  const regEn = t.en.replace(" Certificate", "");
  return {
    head: [
      f(
        "register_form_no",
        "identifiers",
        `${regAm[type]} መመዝገቢያ ቅጽ ቁጥር`,
        `${regEn} Register Form Number`,
        "text",
      ),
      f(
        "registration_uid",
        "identifiers",
        `${regAm[type]} ምዝገባ ልዩ መለያ ቁጥር`,
        `${regEn} Registration Unique Identification Number`,
        "text",
        "event_number",
      ),
    ],
    tail: [
      f(
        "registration_date",
        "event",
        `${regAm[type]} ምዝገባ ቀን`,
        `Date of ${regEn} Registration`,
        "date",
        "registration_date",
      ),
      f(
        "certificate_issued_date",
        "event",
        "የምስክር ወረቀቱ የተሰጠበት ቀን",
        "Date of Certificate Issued",
        "date",
        "issued_date",
      ),
      f("issuing_woreda", "event", "የሰጠው ወረዳ", "Issuing Woreda", "bilingual", "woreda_name"),
      f(
        "registrar_name",
        "registrar",
        "የወሳኝ ኩነት መዝጋቢ ስም",
        "Name of Civil Registrar",
        "bilingual",
        "registrar_name",
      ),
      f(
        "registrar_father_name",
        "registrar",
        "የመዝጋቢው የአባት ስም",
        "Registrar's Father's Name",
        "bilingual",
        "registrar_father_name",
      ),
      f(
        "registrar_grandfather_name",
        "registrar",
        "የመዝጋቢው የአያት ስም",
        "Registrar's Grandfather's Name",
        "bilingual",
        "registrar_grandfather_name",
      ),
      f(
        "registrar_signature",
        "registrar",
        "የመዝጋቢው ፊርማ",
        "Registrar's Signature",
        "image",
        "registrar_signature",
      ),
      f("seal", "registrar", "ማህተም", "Seal", "image", "seal"),
    ],
  };
}

function birthPlaceBlock(prefix: string, group: FieldGroup, withWoreda: boolean) {
  const out = [
    f(`${prefix}_birth_place`, group, "የትውልድ ቦታ / ሀገር", "Place / Country of Birth", "bilingual"),
    f(`${prefix}_region`, group, "ክልል / ከተማ አስተዳደር", "Region / City Administration", "bilingual"),
    f(`${prefix}_zone`, group, "ዞን / ከተማ አስተዳደር", "Zone / City Administration", "bilingual"),
  ];
  if (withWoreda) {
    out.push(f(`${prefix}_woreda`, group, "ወረዳ / ልዩ ወረዳ", "Woreda / Special Woreda", "bilingual"));
  }
  return out;
}

function parentsBlock() {
  return [
    f("mother_full_name", "spouse_parents", "የእናት ሙሉ ስም", "Mother's Full Name", "bilingual"),
    f("mother_nationality", "spouse_parents", "የእናት ዜግነት", "Mother's Nationality", "bilingual"),
    f("father_full_name", "spouse_parents", "የአባት ሙሉ ስም", "Father's Full Name", "bilingual"),
    f("father_nationality", "spouse_parents", "የአባት ዜግነት", "Father's Nationality", "bilingual"),
  ];
}

function build(type: CertificateType): CertificateField[] {
  const { head, tail } = common(type);
  switch (type) {
    case "birth":
      return [
        ...head,
        ...personName("child", "applicant", "የልጁ", "Child's"),
        f("child_sex", "applicant", "ጾታ", "Sex", "sex"),
        f(
          "child_date_of_birth",
          "applicant",
          "የትውልድ ቀን",
          "Date of Birth",
          "date",
          "input",
          "event_date",
        ),
        ...birthPlaceBlock("child", "applicant", true),
        f("child_nationality", "applicant", "ዜግነት", "Nationality", "bilingual"),
        ...parentsBlock(),
        ...tail,
      ];
    case "death":
      return [
        ...head,
        f(
          "deceased_birth_reg_uid",
          "identifiers",
          "የልደት ምዝገባ ልዩ መለያ ቁጥር",
          "Birth Registration Unique Identification Number",
          "text",
        ),
        ...personName("deceased", "applicant", "የሟች", "Deceased's"),
        f("deceased_title", "applicant", "ማዕረግ", "Title", "bilingual"),
        f("deceased_sex", "applicant", "ጾታ", "Sex", "sex"),
        f("deceased_date_of_birth", "applicant", "የትውልድ ቀን", "Date of Birth", "date"),
        f("deceased_nationality", "applicant", "ዜግነት", "Nationality", "bilingual"),
        f("place_of_death", "event", "የሞተበት ቦታ", "Place of Death", "bilingual"),
        f("date_of_death", "event", "የሞተበት ቀን", "Date of Death", "date", "input", "event_date"),
        ...tail,
      ];
    case "marriage":
      return [
        ...head,
        f(
          "wife_birth_reg_uid",
          "identifiers",
          "የሚስት የልደት ምዝገባ ልዩ መለያ ቁጥር",
          "Wife's Birth Registration Unique Identification Number",
          "text",
        ),
        f(
          "husband_birth_reg_uid",
          "identifiers",
          "የባል የልደት ምዝገባ ልዩ መለያ ቁጥር",
          "Husband's Birth Registration Unique Identification Number",
          "text",
        ),
        ...personName("wife", "applicant", "የሚስት", "Wife's"),
        f("wife_date_of_birth", "applicant", "የሚስት የትውልድ ቀን", "Wife's Date of Birth", "date"),
        f("wife_nationality", "applicant", "የሚስት ዜግነት", "Wife's Nationality", "bilingual"),
        ...personName("husband", "spouse_parents", "የባል", "Husband's"),
        f(
          "husband_date_of_birth",
          "spouse_parents",
          "የባል የትውልድ ቀን",
          "Husband's Date of Birth",
          "date",
        ),
        f(
          "husband_nationality",
          "spouse_parents",
          "የባል ዜግነት",
          "Husband's Nationality",
          "bilingual",
        ),
        f(
          "date_of_marriage",
          "event",
          "ጋብቻው የተፈጸመበት ቀን",
          "Date of Marriage",
          "date",
          "input",
          "event_date",
        ),
        f("marriage_place", "event", "የጋብቻ ምዝገባ ቦታ", "Place of Marriage Registration", "bilingual"),
        f(
          "marriage_region",
          "event",
          "ክልል / ከተማ አስተዳደር",
          "Region / City Administration",
          "bilingual",
        ),
        f("marriage_zone", "event", "ዞን / ከተማ አስተዳደር", "Zone / City Administration", "bilingual"),
        f("marriage_city", "event", "ከተማ", "City", "bilingual"),
        f("marriage_subcity", "event", "ክፍለ ከተማ", "Sub City", "bilingual"),
        f("marriage_woreda", "event", "ወረዳ / ልዩ ወረዳ", "Woreda / Special Woreda", "bilingual"),
        f("marriage_kebele", "event", "ቀበሌ", "Kebele", "bilingual"),
        ...tail,
      ];
    case "divorce": {
      const party = (n: 1 | 2, group: FieldGroup) => [
        f(
          `party${n}_birth_reg_uid`,
          "identifiers",
          `የተፋቺ ${n} የልደት ምዝገባ ልዩ መለያ ቁጥር`,
          `Divorcee ${n} Birth Registration Unique Identification Number`,
          "text",
        ),
        ...personName(`party${n}`, group, `የተፋቺ ${n}`, `Divorcee ${n}`),
        f(
          `party${n}_date_of_birth`,
          group,
          `የተፋቺ ${n} የትውልድ ቀን`,
          `Divorcee ${n} Date of Birth`,
          "date",
        ),
        ...birthPlaceBlock(`party${n}`, group, false),
        f(
          `party${n}_nationality`,
          group,
          `የተፋቺ ${n} ዜግነት`,
          `Divorcee ${n} Nationality`,
          "bilingual",
        ),
      ];
      return [
        ...head,
        ...party(1, "applicant"),
        ...party(2, "spouse_parents"),
        f(
          "date_of_divorce",
          "event",
          "ፍቺው የተፈጸመበት ቀን",
          "Date of Divorce",
          "date",
          "input",
          "event_date",
        ),
        f("divorce_place", "event", "ፍቺው የተፈጸመበት ቦታ", "Place of Divorce Dissolved", "bilingual"),
        ...tail,
      ];
    }
    case "adoption":
      return [
        ...head,
        f(
          "adoptee_birth_reg_uid",
          "identifiers",
          "የልደት ምዝገባ ልዩ መለያ ቁጥር",
          "Birth Registration Unique Identification Number",
          "text",
        ),
        ...personName("adoptee", "applicant", "የጉዲፈቻ ልጁ", "Adoptee's"),
        f("adoptee_sex", "applicant", "ጾታ", "Sex", "sex"),
        f("adoptee_date_of_birth", "applicant", "የትውልድ ቀን", "Date of Birth", "date"),
        ...birthPlaceBlock("adoptee", "applicant", false),
        ...parentsBlock(),
        ...tail,
      ];
  }
}

export const CERTIFICATE_FIELDS: Record<CertificateType, CertificateField[]> = {
  birth: build("birth"),
  death: build("death"),
  marriage: build("marriage"),
  divorce: build("divorce"),
  adoption: build("adoption"),
};

export function certificateField(type: CertificateType, key: string): CertificateField | undefined {
  return CERTIFICATE_FIELDS[type].find((x) => x.key === key);
}

/** Fields captured on the Certificate details card (everything with source "input"). */
export function inputFields(type: CertificateType): CertificateField[] {
  return CERTIFICATE_FIELDS[type].filter((x) => x.source === "input");
}

// ---------------------------------------------------------------------------
// Formats a placed template field can choose, per kind.
// ---------------------------------------------------------------------------

export type FieldFormat =
  | "am"
  | "en"
  | "am_en"
  | "plain"
  | "ec_full"
  | "ec_day"
  | "ec_month"
  | "ec_year"
  | "gc_full"
  | "gc_day"
  | "gc_month"
  | "gc_year"
  | "image";

export const FORMAT_LABELS: Record<FieldFormat, string> = {
  am: "አማርኛ / Amharic",
  en: "English",
  am_en: "አማርኛ / English",
  plain: "As entered",
  ec_full: "ዓ.ም ሙሉ / Ethiopian, full",
  ec_day: "ዓ.ም ቀን / Ethiopian day",
  ec_month: "ዓ.ም ወር / Ethiopian month",
  ec_year: "ዓ.ም ዓመት / Ethiopian year",
  gc_full: "Gregorian, full",
  gc_day: "Gregorian day",
  gc_month: "Gregorian month",
  gc_year: "Gregorian year",
  image: "Image",
};

export function formatsFor(kind: FieldKind): FieldFormat[] {
  switch (kind) {
    case "bilingual":
    case "sex":
      return ["am", "en", "am_en"];
    case "text":
      return ["plain"];
    case "date":
      return [
        "ec_full",
        "ec_day",
        "ec_month",
        "ec_year",
        "gc_full",
        "gc_day",
        "gc_month",
        "gc_year",
      ];
    case "image":
      return ["image"];
  }
}

export function defaultFormat(kind: FieldKind): FieldFormat {
  return formatsFor(kind)[0];
}

const GC_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Ethiopian full date with Arabic numerals: "12 ጥር 2017 ዓ.ም". */
export function formatDateValue(iso: string | null | undefined, format: FieldFormat): string {
  if (!iso) return "";
  const d = parseStoredDate(iso);
  if (!d) return "";
  if (format.startsWith("ec_")) {
    const e = gregorianToEthiopian(d);
    const month = ETHIOPIAN_MONTHS_AM[e.month - 1];
    if (format === "ec_day") return String(e.day);
    if (format === "ec_month") return month;
    if (format === "ec_year") return String(e.year);
    return `${e.day} ${month} ${e.year} ዓ.ም`;
  }
  if (format === "gc_day") return String(d.getDate());
  if (format === "gc_month") return GC_MONTHS[d.getMonth()];
  if (format === "gc_year") return String(d.getFullYear());
  return `${GC_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const SEX_LABELS: Record<string, { am: string; en: string }> = {
  male: { am: "ወንድ", en: "Male" },
  female: { am: "ሴት", en: "Female" },
};

/**
 * A resolved value: bilingual text carries both scripts, a date its ISO form,
 * plain text / images a single string.
 */
export interface ResolvedValue {
  am?: string | null;
  en?: string | null;
  text?: string | null;
  date?: string | null;
  image?: string | null;
}

/** Render one placed field to the string printed on the certificate. */
export function renderFieldText(
  field: CertificateField,
  value: ResolvedValue | undefined,
  format: FieldFormat,
): string {
  if (!value) return "";
  switch (field.kind) {
    case "date":
      return formatDateValue(value.date, format);
    case "text":
      return value.text ?? "";
    case "sex": {
      const s = SEX_LABELS[(value.text ?? "").toLowerCase()];
      if (!s) return value.text ?? "";
      return format === "en" ? s.en : format === "am_en" ? `${s.am} / ${s.en}` : s.am;
    }
    case "bilingual": {
      const am = value.am ?? "";
      const en = value.en ?? "";
      if (format === "en") return en || am;
      if (format === "am_en") return [am, en].filter(Boolean).join(" / ");
      return am || en;
    }
    case "image":
      return "";
  }
}

/**
 * Split a stored full name into the three Ethiopian parts (First, Father's,
 * Grandfather's). Extra words stay with the grandfather's name.
 */
export function splitEthiopianName(full: string | null | undefined): [string, string, string] {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return [parts[0] ?? "", parts[1] ?? "", parts.slice(2).join(" ")];
}
