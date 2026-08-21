// Ethiopian (Ge'ez) calendar conversion.
// Algorithm based on the standard JDN (Julian Day Number) approach which
// produces exact Gregorian <-> Ethiopian conversions for any date.

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
const ETHIOPIC_EPOCH = 1724220;

export function gregorianToEthiopian(date: Date): EthiopianDate {
  const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const r = (jdn - ETHIOPIC_EPOCH) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year =
    4 * Math.floor((jdn - ETHIOPIC_EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
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

export function ethiopianToGregorian(e: EthiopianDate): Date {
  const jdn =
    ETHIOPIC_EPOCH + 365 * (e.year - 1) + Math.floor(e.year / 4) + 30 * (e.month - 1) + (e.day - 1);
  return jdnToGregorian(jdn);
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
