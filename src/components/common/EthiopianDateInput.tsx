import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  ETHIOPIAN_MONTHS_AM,
  ethiopianToGregorian,
  gregorianToEthiopian,
  isValidEthiopianDate,
} from "@/utils/ethiopianCalendar";

interface Props {
  /** ISO yyyy-mm-dd Gregorian date string, or "" */
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  ariaInvalid?: boolean;
  disabled?: boolean;
}

function isoToEth(iso: string): { y: string; m: string; d: string } | null {
  if (!iso) return null;
  const parts = iso.split("-");
  if (parts.length !== 3) return null;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return null;
  const e = gregorianToEthiopian(d);
  return { y: String(e.year), m: String(e.month), d: String(e.day) };
}

export function EthiopianDateInput({ value, onChange, id, ariaInvalid, disabled }: Props) {
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  // Track the last ISO value we either emitted or absorbed from props,
  // so we only re-sync local fields when the external value actually changes.
  const lastSyncedRef = useRef<string>("");

  // Initial sync + external resets only
  useEffect(() => {
    if (value === lastSyncedRef.current) return;
    lastSyncedRef.current = value;
    const parsed = isoToEth(value);
    if (!parsed) {
      if (!value) {
        setYear("");
        setMonth("");
        setDay("");
      }
      return;
    }
    setYear(parsed.y);
    setMonth(parsed.m);
    setDay(parsed.d);
  }, [value]);

  const commit = (y: string, m: string, dy: string) => {
    const yN = Number(y);
    const mN = Number(m);
    const dN = Number(dy);
    if (!yN || !mN || !dN) {
      // Mid-edit: do NOT clear external value.
      return;
    }
    const e = { year: yN, month: mN, day: dN };
    if (!isValidEthiopianDate(e)) {
      return;
    }
    const g = ethiopianToGregorian(e);
    const iso = `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, "0")}-${String(g.getDate()).padStart(2, "0")}`;
    if (iso !== lastSyncedRef.current) {
      lastSyncedRef.current = iso;
      onChange(iso);
    }
  };

  const gregorianPreview = (() => {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB");
  })();

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          placeholder="ቀን / Day"
          aria-invalid={ariaInvalid}
          disabled={disabled}
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            commit(year, month, e.target.value);
          }}
          min={1}
          max={30}
        />
        <select
          className="font-noto-ethiopic flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          value={month}
          disabled={disabled}
          onChange={(e) => {
            setMonth(e.target.value);
            commit(year, e.target.value, day);
          }}
          aria-label="Month"
        >
          <option value="">ወር / Month</option>
          {ETHIOPIAN_MONTHS_AM.map((name, idx) => (
            <option key={name} value={idx + 1}>
              {name}
            </option>
          ))}
        </select>
        <Input
          type="number"
          inputMode="numeric"
          placeholder="ዓ.ም / Year"
          disabled={disabled}
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            commit(e.target.value, month, day);
          }}
          min={1900}
          max={2100}
        />
      </div>
      {gregorianPreview && (
        <p className="mt-1 text-xs text-slate-500">Gregorian: {gregorianPreview}</p>
      )}
    </div>
  );
}
