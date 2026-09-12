import { describe, expect, it } from "vitest";
import {
  ETHIOPIAN_MONTHS_AM,
  ETHIOPIAN_MONTHS_EN,
  ethiopianToGregorian,
  formatEthiopianDate,
  formatEthiopianDateOnly,
  formatEthiopianDateShort,
  formatEthiopianDateShortOnly,
  gregorianToEthiopian,
  isValidEthiopianDate,
  parseDateOnly,
  parseStoredDate,
  type EthiopianDate,
} from "@/utils/ethiopianCalendar";

describe("gregorianToEthiopian / ethiopianToGregorian round trip", () => {
  it("round-trips an ordinary date exactly", () => {
    const g = new Date(1990, 5, 15); // 15 June 1990
    expect(ethiopianToGregorian(gregorianToEthiopian(g))).toEqual(g);
  });

  it("round-trips a Gregorian leap day (29 Feb)", () => {
    const g = new Date(2000, 1, 29);
    const e = gregorianToEthiopian(g);
    expect(ethiopianToGregorian(e)).toEqual(g);
  });

  it("round-trips the first and last day of a Gregorian year", () => {
    for (const g of [new Date(2024, 0, 1), new Date(2024, 11, 31)]) {
      expect(ethiopianToGregorian(gregorianToEthiopian(g))).toEqual(g);
    }
  });

  it("round-trips a wide spread of years without drifting", () => {
    for (const year of [1930, 1965, 1980, 2001, 2016, 2024, 2050]) {
      const g = new Date(year, 6, 1); // 1 July, safely away from any boundary
      expect(ethiopianToGregorian(gregorianToEthiopian(g))).toEqual(g);
    }
  });
});

describe("New Year boundary (Meskerem 1) -- the case a birthday/age calculation gets wrong", () => {
  // Ethiopian New Year falls on 11 September in a common Gregorian year and
  // 12 September in the Gregorian year immediately before a Gregorian leap
  // year (the extra day shifts it by one). This is the single most common
  // source of an off-by-one-year bug when converting a birth date near the
  // boundary -- these pin the exact transition day rather than trusting an
  // approximate "September-ish" rule.
  it("crosses into the new Ethiopian year on 12 September the year before a Gregorian leap year", () => {
    // 2023 -> 2024 is a leap year, so New Year lands on 12 Sept 2023.
    expect(gregorianToEthiopian(new Date(2023, 8, 11))).toEqual({ year: 2015, month: 13, day: 6 });
    expect(gregorianToEthiopian(new Date(2023, 8, 12))).toEqual({ year: 2016, month: 1, day: 1 });
  });

  it("crosses into the new Ethiopian year on 11 September in an ordinary year", () => {
    // 2024 -> 2025 is not a leap year, so New Year lands on 11 Sept 2024.
    expect(gregorianToEthiopian(new Date(2024, 8, 10))).toEqual({ year: 2016, month: 13, day: 5 });
    expect(gregorianToEthiopian(new Date(2024, 8, 11))).toEqual({ year: 2017, month: 1, day: 1 });
  });

  it("matches the historically documented Ethiopian Millennium transition", () => {
    // Widely documented: Meskerem 1, 2000 EC fell on 12 September 2007 GC.
    expect(gregorianToEthiopian(new Date(2007, 8, 12))).toEqual({ year: 2000, month: 1, day: 1 });
    expect(gregorianToEthiopian(new Date(2007, 8, 11))).toEqual({ year: 1999, month: 13, day: 6 });
    expect(ethiopianToGregorian({ year: 2000, month: 1, day: 1 })).toEqual(new Date(2007, 8, 12));
  });

  it("a birthday one Gregorian day apart can land in a different Ethiopian year across the boundary", () => {
    // The exact scenario an age calculation must get right: two people born
    // a day apart straddling the boundary are a full Ethiopian year apart.
    const bornBefore = gregorianToEthiopian(new Date(2016, 8, 10));
    const bornAfter = gregorianToEthiopian(new Date(2016, 8, 11));
    expect(bornAfter.year - bornBefore.year).toBe(1);
  });
});

describe("isValidEthiopianDate", () => {
  it("accepts an ordinary day in a 30-day month", () => {
    expect(isValidEthiopianDate({ year: 2016, month: 1, day: 30 })).toBe(true);
  });

  it("rejects day 0 and negative days", () => {
    expect(isValidEthiopianDate({ year: 2016, month: 1, day: 0 })).toBe(false);
    expect(isValidEthiopianDate({ year: 2016, month: 1, day: -1 })).toBe(false);
  });

  it("rejects day 31 in any of the 12 ordinary 30-day months", () => {
    for (let month = 1; month <= 12; month++) {
      expect(isValidEthiopianDate({ year: 2016, month, day: 31 })).toBe(false);
    }
  });

  it("rejects month 0 and month 14", () => {
    expect(isValidEthiopianDate({ year: 2016, month: 0, day: 1 })).toBe(false);
    expect(isValidEthiopianDate({ year: 2016, month: 14, day: 1 })).toBe(false);
  });

  // Pagume (month 13) is the short 5-6 day 13th month -- the calendar's own
  // leap-day boundary, same shape of bug as Meskerem 1 above but at the
  // other end of the year.
  it("accepts Pagume day 5 in every year (leap or not)", () => {
    expect(isValidEthiopianDate({ year: 2015, month: 13, day: 5 })).toBe(true); // leap
    expect(isValidEthiopianDate({ year: 2016, month: 13, day: 5 })).toBe(true); // not leap
  });

  it("accepts Pagume day 6 only in an Ethiopian leap year (year % 4 === 3)", () => {
    expect(2015 % 4).toBe(3);
    expect(isValidEthiopianDate({ year: 2015, month: 13, day: 6 })).toBe(true);
    expect(2016 % 4).not.toBe(3);
    expect(isValidEthiopianDate({ year: 2016, month: 13, day: 6 })).toBe(false);
  });

  it("rejects Pagume day 7 even in a leap year", () => {
    expect(isValidEthiopianDate({ year: 2015, month: 13, day: 7 })).toBe(false);
  });
});

describe("parseDateOnly", () => {
  it("parses a well-formed yyyy-mm-dd string as a local date", () => {
    const d = parseDateOnly("2024-03-15");
    expect(d).not.toBeNull();
    expect([d!.getFullYear(), d!.getMonth(), d!.getDate()]).toEqual([2024, 2, 15]);
  });

  it("does not shift the day backward the way new Date(iso) can in a negative-UTC-offset zone", () => {
    // The whole reason this helper exists: new Date("2024-03-15") parses as
    // UTC midnight, which prints as 14 March in any timezone behind UTC.
    const d = parseDateOnly("2024-03-15")!;
    expect(d.getDate()).toBe(15);
  });

  it("returns null for a malformed string", () => {
    expect(parseDateOnly("not-a-date")).toBeNull();
    expect(parseDateOnly("2024-03")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
  });
});

describe("parseStoredDate", () => {
  it("routes a bare date string through the local-calendar parse", () => {
    const d = parseStoredDate("2024-03-15")!;
    expect(d.getDate()).toBe(15);
  });

  it("routes a full timestamp through standard Date parsing", () => {
    const iso = "2024-03-15T10:30:00.000Z";
    expect(parseStoredDate(iso)).toEqual(new Date(iso));
  });

  it("returns null for a malformed timestamp", () => {
    expect(parseStoredDate("not-a-timestamp")).toBeNull();
  });
});

describe("formatting helpers", () => {
  it("formatEthiopianDate renders day, Amharic month name and year", () => {
    const e: EthiopianDate = { year: 2000, month: 1, day: 1 };
    expect(formatEthiopianDate(ethiopianToGregorian(e))).toBe(`1 ${ETHIOPIAN_MONTHS_AM[0]} 2000`);
  });

  it("formatEthiopianDateShort zero-pads day and month", () => {
    const e: EthiopianDate = { year: 2000, month: 1, day: 1 };
    expect(formatEthiopianDateShort(ethiopianToGregorian(e))).toBe("01/01/2000");
  });

  it("formatEthiopianDateOnly falls back on a malformed ISO string instead of throwing", () => {
    expect(formatEthiopianDateOnly("garbage")).toBe("—");
    expect(formatEthiopianDateOnly("garbage", "N/A")).toBe("N/A");
  });

  it("formatEthiopianDateShortOnly falls back on a malformed ISO string instead of throwing", () => {
    expect(formatEthiopianDateShortOnly("garbage")).toBe("—");
  });

  it("every Amharic month name has an English counterpart at the same index", () => {
    expect(ETHIOPIAN_MONTHS_AM.length).toBe(13);
    expect(ETHIOPIAN_MONTHS_EN.length).toBe(13);
  });
});
