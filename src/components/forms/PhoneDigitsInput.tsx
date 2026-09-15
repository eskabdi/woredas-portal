import { Input } from "@/components/ui/input";
import { PHONE_COUNTRY_CODE, applyPhoneDigitsChange } from "@/lib/phoneNumber";

/** The "+251 | 9XXXXXXXX" input pair shared by every phone field in the app. */
export function PhoneDigitsInput({
  value,
  onChange,
  onBlur,
  className = "",
}: {
  value: string;
  onChange: (digits: string) => void;
  onBlur?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex ${className}`}>
      <span className="font-mono inline-flex h-10 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-slate-50 px-3 text-sm text-slate-600">
        {PHONE_COUNTRY_CODE}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(applyPhoneDigitsChange(value, e.target.value))}
        onBlur={onBlur}
        placeholder="9XXXXXXXX"
        inputMode="numeric"
        className="rounded-l-none font-mono"
      />
    </div>
  );
}
