/**
 * Birr amount → words, in both Amharic and English, for the "amount in
 * words" line on printed revenue receipts (a legal-document convention:
 * the numeric total and its written-out form must both be present so a
 * digit can't be silently altered after issuance).
 *
 * Ethiopian usage drops the leading "one" before a bare multiplier ("ሺህ",
 * not "አንድ ሺህ", for exactly 1000 -- same for "መቶ"/100 and "ሚሊዮን"/1,000,000).
 * English keeps the same convention it always has ("one thousand", not "a
 * thousand"), so the two converters are deliberately not structural mirrors
 * of each other.
 */

const EN_ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const EN_TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];
const EN_SCALES = ["", "Thousand", "Million", "Billion"];

function enGroup(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${EN_ONES[hundreds]} Hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(EN_ONES[rest]);
    else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(ones > 0 ? `${EN_TENS[tens]}-${EN_ONES[ones]}` : EN_TENS[tens]);
    }
  }
  return parts.join(" ");
}

function enInteger(n: number): string {
  if (n === 0) return "Zero";
  const groups: string[] = [];
  let scale = 0;
  let remaining = n;
  while (remaining > 0) {
    const group = remaining % 1000;
    if (group > 0) {
      const label = EN_SCALES[scale];
      groups.unshift(label ? `${enGroup(group)} ${label}` : enGroup(group));
    }
    remaining = Math.floor(remaining / 1000);
    scale += 1;
  }
  return groups.join(" ");
}

const AM_ONES = ["", "አንድ", "ሁለት", "ሶስት", "አራት", "አምስት", "ስድስት", "ሰባት", "ስምንት", "ዘጠኝ"];
const AM_TEENS = [
  "አስር",
  "አስራ አንድ",
  "አስራ ሁለት",
  "አስራ ሶስት",
  "አስራ አራት",
  "አስራ አምስት",
  "አስራ ስድስት",
  "አስራ ሰባት",
  "አስራ ስምንት",
  "አስራ ዘጠኝ",
];
const AM_TENS = ["", "", "ሃያ", "ሰላሳ", "አርባ", "ሃምሳ", "ስልሳ", "ሰባ", "ሰማንያ", "ዘጠና"];
const AM_SCALES = ["", "ሺህ", "ሚሊዮን", "ቢሊዮን"];

function amGroup(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(hundreds === 1 ? "መቶ" : `${AM_ONES[hundreds]} መቶ`);
  if (rest > 0) {
    if (rest < 10) parts.push(AM_ONES[rest]);
    else if (rest < 20) parts.push(AM_TEENS[rest - 10]);
    else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(ones > 0 ? `${AM_TENS[tens]} ${AM_ONES[ones]}` : AM_TENS[tens]);
    }
  }
  return parts.join(" ");
}

function amInteger(n: number): string {
  if (n === 0) return "ዜሮ";
  const groups: string[] = [];
  let scale = 0;
  let remaining = n;
  while (remaining > 0) {
    const group = remaining % 1000;
    if (group > 0) {
      const label = AM_SCALES[scale];
      if (!label) groups.unshift(amGroup(group));
      else groups.unshift(group === 1 ? label : `${amGroup(group)} ${label}`);
    }
    remaining = Math.floor(remaining / 1000);
    scale += 1;
  }
  return groups.join(" ");
}

/** Splits a numeric(12,2) amount into whole birr and rounded cents (0-99). */
function splitBirrCents(amount: number): { birr: number; cents: number } {
  const rounded = Math.round(Math.abs(amount) * 100);
  return { birr: Math.floor(rounded / 100), cents: rounded % 100 };
}

export function amountInWordsEn(amount: number): string {
  const { birr, cents } = splitBirrCents(amount);
  const birrWords = `${enInteger(birr)} Birr`;
  const centsWords = cents > 0 ? ` and ${enInteger(cents)} Cents` : "";
  return `${birrWords}${centsWords} only`;
}

export function amountInWordsAm(amount: number): string {
  const { birr, cents } = splitBirrCents(amount);
  const birrWords = `${amInteger(birr)} ብር`;
  const centsWords = cents > 0 ? ` ከ${amInteger(cents)} ሳንቲም` : "";
  return `${birrWords}${centsWords} ብቻ`;
}
