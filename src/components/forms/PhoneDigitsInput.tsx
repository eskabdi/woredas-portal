import { Input } from "@/components/ui/input";
import { PHONE_COUNTRY_CODE, sanitizePhoneDigits } from "@/lib/phoneNumber";

/** The "+251 | 9XXXXXXXX" input pair shared by every phone field in the app. */
export function PhoneDigitsInput({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (digits: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex ${className}`}>
      <span className="font-mono inline-flex h-10 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-slate-50 px-3 text-sm text-slate-600">
        {PHONE_COUNTRY_CODE}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(sanitizePhoneDigits(e.target.value))}
        placeholder="9XXXXXXXX"
        inputMode="numeric"
        className="rounded-l-none font-mono"
      />
    </div>
  );
}
