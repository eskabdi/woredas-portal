import { Label } from "@/components/ui/label";
import { kebeleOptionLabel, useKebeleOptions } from "@/hooks/useKebeleOptions";

interface KebeleFilterProps {
  value: string;
  onChange: (kebeleId: string) => void;
  className?: string;
  /** Optional extra note shown under the select */
  hint?: string;
}

/** Shared "filter by kebele" dropdown, tenant-scoped. */
export function KebeleFilter({ value, onChange, className, hint }: KebeleFilterProps) {
  const { data: kebeles, isLoading } = useKebeleOptions();

  return (
    <div className={className}>
      <Label className="font-noto-ethiopic text-xs">ቀበሌ / Kebele</Label>
      <select
        className="mt-1 block h-10 w-[220px] rounded-md border border-input bg-background px-3 text-sm"
        value={value}
        disabled={isLoading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">ሁሉም ቀበሌዎች / All kebeles</option>
        {(kebeles ?? []).map((k) => (
          <option key={k.kebele_id} value={k.kebele_id}>
            {kebeleOptionLabel(k)}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
