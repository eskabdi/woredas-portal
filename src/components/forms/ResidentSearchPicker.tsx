import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface ResidentMatch {
  resident_id: string;
  resident_number: string;
  full_name_am: string | null;
  full_name: string | null;
}

interface Props {
  value: string;
  onChange: (residentId: string, resident: ResidentMatch | null) => void;
  woredaId: string;
  placeholder?: string;
  excludeResidentIds?: string[];
  disabled?: boolean;
}

export function ResidentSearchPicker({
  value,
  onChange,
  woredaId,
  placeholder,
  excludeResidentIds = [],
  disabled,
}: Props) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ResidentMatch | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  // Resolve initial value (e.g. when editing)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!value) {
        setSelected(null);
        return;
      }
      if (selected?.resident_id === value) return;
      const { data } = await supabase
        .from("resident")
        .select("resident_id, resident_number, full_name_am, full_name")
        .eq("resident_id", value)
        .maybeSingle();
      if (!cancelled && data) setSelected(data);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [value, selected?.resident_id]);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const query = useQuery({
    queryKey: ["resident-search-picker", woredaId, debounced],
    enabled: open && !!woredaId && debounced.length >= 2,
    queryFn: async () => {
      const escaped = debounced.replace(/[%,]/g, "");
      const { data, error } = await supabase
        .from("resident")
        .select("resident_id, resident_number, full_name_am, full_name")
        .eq("woreda_id", woredaId)
        .or(
          [
            `full_name_am.ilike.%${escaped}%`,
            `full_name.ilike.%${escaped}%`,
            `resident_number.ilike.%${escaped}%`,
          ].join(","),
        )
        .limit(15);
      if (error) throw error;
      return (data ?? []).filter((r) => !excludeResidentIds.includes(r.resident_id));
    },
  });

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="font-noto-ethiopic truncate text-sm font-medium text-slate-900">
            {selected.full_name_am || selected.full_name || "—"}
          </div>
          <div className="font-mono text-xs text-slate-500">{selected.resident_number}</div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setTerm("");
              onChange("", null);
            }}
            className="rounded p-1 text-slate-500 hover:bg-blue-100 hover:text-red-600"
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={placeholder ?? "በስም ወይም በመለያ ቁጥር ይፈልጉ / Search by name or resident #"}
          className="font-noto-ethiopic pl-10"
        />
      </div>
      {open && debounced.length >= 2 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {query.isLoading && (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          )}
          {!query.isLoading && (query.data?.length ?? 0) === 0 && (
            <div className="font-noto-ethiopic px-3 py-3 text-sm text-slate-500">
              ምንም ውጤት የለም / No matches
            </div>
          )}
          {query.data?.map((r) => (
            <button
              key={r.resident_id}
              type="button"
              onClick={() => {
                setSelected(r);
                setOpen(false);
                setTerm("");
                onChange(r.resident_id, r);
              }}
              className="block w-full px-3 py-2 text-left hover:bg-blue-50"
            >
              <div className="font-noto-ethiopic text-sm font-medium text-slate-900">
                {r.full_name_am || r.full_name || "—"}
              </div>
              <div className="font-mono text-xs text-slate-500">{r.resident_number}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
