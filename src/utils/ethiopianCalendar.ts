// Ethiopian (Ge'ez) calendar conversion.
// Algorithm based on the standard JDN (Julian Day Number) approach, which
// produces exact Gregorian <-> Ethiopian conversions for any date. The two
// directions use two different (but related) epoch constants — see the note
// above ETHIOPIC_EPOCH below before "simplifying" them into one.

export const ETHIOPIAN_MONTHS_AM = [
  "መስከረም",
  "ጥቅምት",
  "ኅዳር",
  "ታኅሣሥ",
  "ጥር",
  "የካቲት",
  "መጋቢት",
  "ሚያዝያ",
  "ግንቦት",
  "ሰኔ",
  "ሐምሌ",
  "ነሐሴ",
  "ጳጉሜ",
];

export const ETHIOPIAN_MONTHS_EN = [
  "Meskerem",
  "Tikimt",
  "Hidar",
  "Tahsas",
  "Tir",
  "Yekatit",
  "Megabit",
  "Miyazya",
  "Ginbot",
  "Sene",
  "Hamle",
  "Nehase",
  "Pagume",
];

export interface EthiopianDate {
  year: number;
  month: number; // 1-13
  day: number;
}

// Convert a Gregorian date to a Julian Day Number.
function gregorianToJDN(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yr = y + 4800 - a;
  const mo = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * mo + 2) / 5) +
    365 * yr +
    Math.floor(yr / 4) -
    Math.floor(yr / 100) +
    Math.floor(yr / 400) -
    32045
  );
}

// Ethiopian epoch JDN (29 August 8 CE in the Julian calendar -> Meskerem 1, 1 EC).
// NOTE: the two conversion directions below use two different epoch
// constants that are 365 apart. They are NOT interchangeable: each is
// calibrated to its own formula shape (this one anchors year 0 at the epoch,
// ethiopianToGregorian's `365 * (year - 1)` shape anchors year 1 at the
// epoch), and collapsing them into a single constant breaks both directions.
const JDN_EPOCH_OFFSET_AMETE_MIHRET = 1723856;

export function gregorianToEthiopian(date: Date): EthiopianDate {
  const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const r = (jdn - JDN_EPOCH_OFFSET_AMETE_MIHRET) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year =
    4 * Math.floor((jdn - JDN_EPOCH_OFFSET_AMETE_MIHRET) / 1461) +
    Math.floor(r / 365) -
    Math.floor(r / 1460);
  const month = Math.floor(n / 30) + 1;
  const day = (n % 30) + 1;
  return { year, month, day };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatEthiopianDate(date: Date): string {
  const e = gregorianToEthiopian(date);
  return `${e.day} ${ETHIOPIAN_MONTHS_AM[e.month - 1]} ${e.year}`;
}

export function formatEthiopianDateShort(date: Date): string {
  const e = gregorianToEthiopian(date);
  return `${pad2(e.day)}/${pad2(e.month)}/${e.year}`;
}

export function formatEthiopianDateTime(date: Date): string {
  return `${formatEthiopianDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function getCurrentEthiopianDate(): string {
  return formatEthiopianDate(new Date());
}

// Returns the Amharic month name for a given Gregorian date (used for chart axes).
export function ethiopianMonthLabel(date: Date): string {
  const e = gregorianToEthiopian(date);
  return ETHIOPIAN_MONTHS_AM[e.month - 1];
}

function jdnToGregorian(jdn: number): Date {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return new Date(year, month - 1, day);
}

// True JDN of Meskerem 1, 1 EC (= JDN_EPOCH_OFFSET_AMETE_MIHRET + 365).
// See the note above JDN_EPOCH_OFFSET_AMETE_MIHRET: this constant is
// calibrated to the `365 * (year - 1)` formula shape below, not shared with
// gregorianToEthiopian's formula.
const ETHIOPIC_EPOCH = 1724221;

export function ethiopianToGregorian(e: EthiopianDate): Date {
  const jdn =
    ETHIOPIC_EPOCH + 365 * (e.year - 1) + Math.floor(e.year / 4) + 30 * (e.month - 1) + (e.day - 1);
  return jdnToGregorian(jdn);
}

// Parse a date-only ISO string ("yyyy-mm-dd") as a local calendar date,
// avoiding the UTC-midnight interpretation `new Date(iso)` gives, which
// shifts the displayed day backward in any negative-UTC-offset timezone.
// Only use this for `date`-typed columns (date_of_birth, issue_date, etc.);
// genuine timestamptz instants (action_at, revoked_at, ...) should keep
// using `new Date(iso)` as before.
export function parseDateOnly(iso: string): Date | null {
  const parts = iso.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

// For helpers fed values from both `date` and `timestamptz` columns
// (e.g. a shared "created/event date" formatter): a bare `yyyy-mm-dd` string
// is a date-only Postgres `date` value and must use the local-calendar parse
// above; anything else (a full ISO timestamp) is a real instant and should
// keep standard `new Date(...)` parsing.
export function parseStoredDate(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDateOnly(value);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function isValidEthiopianDate(e: EthiopianDate): boolean {
  if (e.month < 1 || e.month > 13) return false;
  if (e.day < 1) return false;
  if (e.month === 13) {
    const isLeap = e.year % 4 === 3;
    return e.day <= (isLeap ? 6 : 5);
  }
  return e.day <= 30;
}
