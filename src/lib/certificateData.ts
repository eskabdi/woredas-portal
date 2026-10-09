/**
 * Resolves the values a civil-registration certificate prints, and the
 * prefill for the event's Certificate details card. Pure functions: the
 * callers fetch the rows, this file only maps them, so Vitest covers it.
 */
import {
  CERTIFICATE_FIELDS,
  type CertificateField,
  type CertificateType,
  type ResolvedValue,
  inputFields,
  splitEthiopianName,
} from "@/config/certificateFields";

/** What the capture card stores in vital_event.event_details.certificate. */
export type CertificateInput = Record<string, string | null | undefined>;

export interface CertificateEventRow {
  event_type: string;
  event_number: string | null;
  event_date: string | null;
  registration_date: string | null;
  issued_at: string | null;
  event_details: Record<string, unknown> | null;
  /** Public verification token, assigned on the first print (migration 102). */
  certificate_token?: string | null;
}

export interface CertificateRegistrar {
  full_name: string | null;
  signature_path: string | null;
}

export interface CertificateWoreda {
  name_am: string | null;
  name_en: string | null;
  stamp_path: string | null;
}

export interface CertificateContext {
  event: CertificateEventRow;
  registrar: CertificateRegistrar | null;
  woreda: CertificateWoreda | null;
  /** ISO date used for "Date of Certificate Issued" when the event has none. */
  printedOn: string;
}

export function isCertificateType(t: string): t is CertificateType {
  return (CERTIFICATE_FIELDS as Record<string, unknown>)[t] !== undefined;
}

export function certificateInputOf(
  event: Pick<CertificateEventRow, "event_details">,
): CertificateInput {
  const raw = (event.event_details ?? {})["certificate"];
  return raw && typeof raw === "object" ? (raw as CertificateInput) : {};
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

function resolveOne(
  field: CertificateField,
  ctx: CertificateContext,
  input: CertificateInput,
): ResolvedValue {
  const { event, registrar, woreda } = ctx;
  const [rFirst, rFather, rGrand] = splitEthiopianName(registrar?.full_name);
  const both = (v: string | null) => ({ am: v, en: v });
  switch (field.source) {
    case "input":
      if (field.kind === "bilingual") {
        return { am: str(input[`${field.key}_am`]), en: str(input[`${field.key}_en`]) };
      }
      if (field.kind === "date") {
        const v = str(input[field.key]);
        if (v) return { date: v };
        return field.fallback === "event_date"
          ? { date: dateOnly(event.event_date) }
          : { date: null };
      }
      return { text: str(input[field.key]) };
    case "event_number":
      return { text: event.event_number };
    case "event_date":
      return { date: dateOnly(event.event_date) };
    case "registration_date":
      return { date: dateOnly(event.registration_date) };
    case "issued_date":
      return { date: dateOnly(event.issued_at) ?? ctx.printedOn };
    case "registrar_name":
      return both(rFirst || null);
    case "registrar_father_name":
      return both(rFather || null);
    case "registrar_grandfather_name":
      return both(rGrand || null);
    case "registrar_signature":
      return { image: registrar?.signature_path ?? null };
    case "seal":
      return { image: woreda?.stamp_path ?? null };
    case "woreda_name":
      return { am: woreda?.name_am ?? null, en: woreda?.name_en ?? null };
    case "certificate_token":
      return { text: event.certificate_token ?? null };
  }
}

/** Every field of the certificate type, keyed by field key. */
export function resolveCertificateValues(
  type: CertificateType,
  ctx: CertificateContext,
): Record<string, ResolvedValue> {
  const input = certificateInputOf(ctx.event);
  const out: Record<string, ResolvedValue> = {};
  for (const field of CERTIFICATE_FIELDS[type]) out[field.key] = resolveOne(field, ctx, input);
  return out;
}

/** Input keys a field occupies in event_details.certificate. */
export function inputKeysOf(field: CertificateField): string[] {
  return field.kind === "bilingual" ? [`${field.key}_am`, `${field.key}_en`] : [field.key];
}

/** A resident linked to the event, as far as the prefill needs it. */
export interface LinkedResident {
  first_name: string | null;
  father_name: string | null;
  grandfather_name: string | null;
  full_name: string | null;
  full_name_am: string | null;
  sex: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  mother_full_name: string | null;
}

export interface PrefillSources {
  /** Residents linked from the event, by role. */
  subject?: LinkedResident | null;
  party1?: LinkedResident | null;
  party2?: LinkedResident | null;
}

function nameParts(r: LinkedResident | null | undefined, fallbackFull: unknown) {
  if (r && (r.first_name || r.father_name)) {
    return {
      first: r.first_name ?? "",
      father: r.father_name ?? "",
      grand: r.grandfather_name ?? "",
    };
  }
  const full = str(fallbackFull) ?? r?.full_name_am ?? r?.full_name ?? null;
  const [first, father, grand] = splitEthiopianName(full);
  return { first, father, grand };
}

function putPerson(
  out: CertificateInput,
  prefix: string,
  r: LinkedResident | null | undefined,
  fallbackFull: unknown,
) {
  const p = nameParts(r, fallbackFull);
  if (p.first) out[`${prefix}_name_am`] = p.first;
  if (p.father) out[`${prefix}_father_name_am`] = p.father;
  if (p.grand) out[`${prefix}_grandfather_name_am`] = p.grand;
  if (r?.date_of_birth) out[`${prefix}_date_of_birth`] = r.date_of_birth.slice(0, 10);
  if (r?.birth_place) out[`${prefix}_birth_place_am`] = r.birth_place;
}

/**
 * Seed the Certificate details card from what the event and its linked
 * residents already hold. Only empty keys are filled -- a value someone
 * typed is never overwritten.
 */
export function certificatePrefill(
  type: CertificateType,
  event: CertificateEventRow,
  sources: PrefillSources = {},
): CertificateInput {
  const d = (event.event_details ?? {}) as Record<string, unknown>;
  const seed: CertificateInput = {};
  const nested = (k: string) =>
    d[k] && typeof d[k] === "object" ? (d[k] as Record<string, unknown>) : {};
  switch (type) {
    case "birth":
      if (str(d.child_first_name)) seed.child_name_am = str(d.child_first_name);
      if (str(d.child_father_name)) seed.child_father_name_am = str(d.child_father_name);
      if (str(d.child_grandfather_name))
        seed.child_grandfather_name_am = str(d.child_grandfather_name);
      if (str(d.child_full_name_en)) {
        const [a, b, c] = splitEthiopianName(str(d.child_full_name_en));
        if (a) seed.child_name_en = a;
        if (b) seed.child_father_name_en = b;
        if (c) seed.child_grandfather_name_en = c;
      }
      if (str(d.sex)) seed.child_sex = str(d.sex);
      if (str(d.place_of_birth)) seed.child_birth_place_am = str(d.place_of_birth);
      if (str(d.mother_name)) seed.mother_full_name_am = str(d.mother_name);
      if (str(d.father_name)) seed.father_full_name_am = str(d.father_name);
      break;
    case "death":
      putPerson(seed, "deceased", sources.subject, d.deceased_name);
      if (str(d.sex) ?? sources.subject?.sex)
        seed.deceased_sex = str(d.sex) ?? sources.subject?.sex;
      if (str(d.place_of_death)) seed.place_of_death_am = str(d.place_of_death);
      break;
    case "marriage": {
      // Which spouse is the wife is decided by the linked resident's sex,
      // never guessed from the order the clerk entered them in.
      const s1 = sources.party1;
      const s2 = sources.party2;
      const wifeIs1 = s1?.sex === "female" || s2?.sex === "male";
      const wifeIs2 = s2?.sex === "female" || s1?.sex === "male";
      if (wifeIs1 && !wifeIs2) {
        putPerson(seed, "wife", s1, nested("spouse1").name);
        putPerson(seed, "husband", s2, nested("spouse2").name);
      } else if (wifeIs2 && !wifeIs1) {
        putPerson(seed, "wife", s2, nested("spouse2").name);
        putPerson(seed, "husband", s1, nested("spouse1").name);
      }
      if (str(d.place)) seed.marriage_place_am = str(d.place);
      break;
    }
    case "divorce":
      putPerson(seed, "party1", sources.party1, nested("spouse1").name);
      putPerson(seed, "party2", sources.party2, nested("spouse2").name);
      if (str(d.court_name)) seed.divorce_place_am = str(d.court_name);
      break;
    case "adoption":
      putPerson(seed, "adoptee", sources.subject, d.adoptee_name);
      if (sources.subject?.sex) seed.adoptee_sex = sources.subject.sex;
      if (str(d.adoptive_mother_name)) seed.mother_full_name_am = str(d.adoptive_mother_name);
      if (str(d.adoptive_father_name)) seed.father_full_name_am = str(d.adoptive_father_name);
      break;
  }
  const current = certificateInputOf(event);
  const allowed = new Set(inputFields(type).flatMap(inputKeysOf));
  const out: CertificateInput = {};
  for (const [k, v] of Object.entries(seed)) {
    if (allowed.has(k) && v && !str(current[k])) out[k] = v;
  }
  return out;
}

/** Inputs the card should still ask for (no value captured yet). */
export function missingInputs(type: CertificateType, input: CertificateInput): CertificateField[] {
  return inputFields(type).filter((field) => inputKeysOf(field).every((k) => !str(input[k])));
}
