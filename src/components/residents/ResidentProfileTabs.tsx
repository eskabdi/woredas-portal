import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CreditCard, ExternalLink, FileText, Home, MapPin, Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/common/StatusChip";
import { supabase } from "@/integrations/supabase/client";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";

function EmptyState({ am, en }: { am: string; en: string }) {
  return (
    <p className="font-noto-ethiopic rounded-md border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
      {am} <span className="text-xs text-slate-400">/ {en}</span>
    </p>
  );
}

function PanelHeading({
  icon: Icon,
  am,
  en,
  count,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  am: string;
  en: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-blue-700" />
        <h3 className="font-noto-ethiopic truncate text-base font-semibold text-slate-900">
          {am} <span className="text-slate-400">/ {en}</span>
        </h3>
        {typeof count === "number" && (
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

/* ---------------- Filter chips ---------------- */

type ChipOption = { value: string; am: string; en: string };

function ChipRow({
  labelAm,
  labelEn,
  options,
  value,
  onChange,
}: {
  labelAm: string;
  labelEn: string;
  options: ChipOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-noto-ethiopic text-xs text-slate-500">
        {labelAm} <span className="text-slate-400">/ {labelEn}</span>
      </span>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={
              "font-noto-ethiopic rounded-full border px-3 py-1 text-xs transition " +
              (active
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700")
            }
          >
            {o.am} <span className={active ? "text-blue-100" : "text-slate-400"}>/ {o.en}</span>
          </button>
        );
      })}
    </div>
  );
}

const RANGE_OPTIONS: ChipOption[] = [
  { value: "30", am: "30 ቀን", en: "30d" },
  { value: "90", am: "90 ቀን", en: "90d" },
  { value: "365", am: "1 ዓመት", en: "1y" },
  { value: "all", am: "ሁሉም", en: "All" },
];

function FilterBar({
  range,
  onRangeChange,
  typeLabelAm,
  typeLabelEn,
  typeOptions,
  type,
  onTypeChange,
  resultCount,
}: {
  range: string;
  onRangeChange: (v: string) => void;
  typeLabelAm?: string;
  typeLabelEn?: string;
  typeOptions?: ChipOption[];
  type?: string;
  onTypeChange?: (v: string) => void;
  resultCount: number;
}) {
  return (
    <div className="mb-4 space-y-2 rounded-md border border-slate-200 bg-slate-50/70 p-3">
      <ChipRow
        labelAm="ጊዜ"
        labelEn="Period"
        options={RANGE_OPTIONS}
        value={range}
        onChange={onRangeChange}
      />
      {typeOptions && onTypeChange && (
        <ChipRow
          labelAm={typeLabelAm ?? "አይነት"}
          labelEn={typeLabelEn ?? "Type"}
          options={typeOptions}
          value={type ?? "all"}
          onChange={onTypeChange}
        />
      )}
      <p className="text-[11px] text-slate-500">{resultCount} record(s) match the filters</p>
    </div>
  );
}

/** True when `value` falls inside the selected range (days back from today). */
function inRange(value: string | null | undefined, range: string) {
  if (range === "all") return true;
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = Date.now() - Number(range) * 24 * 60 * 60 * 1000;
  return d.getTime() >= cutoff;
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatEthiopianDate(d)} · ${d.toLocaleDateString()}`;
}

/* ---------------- Household tab ---------------- */

export function HouseholdTab({
  residentId,
  woredaId,
  householdId,
}: {
  residentId: string;
  woredaId: string | null;
  householdId: string | null;
}) {
  const q = useQuery({
    queryKey: ["resident-tab-household", householdId, residentId, woredaId],
    enabled: !!householdId && !!woredaId,
    queryFn: async () => {
      const [hh, members] = await Promise.all([
        supabase
          .from("household")
          .select(
            `household_id, house_number, house_label, occupancy_status, address_line,
             sub_woreda, phone_number, house_type, rent_amount, household_head_resident_id,
             kebele:kebele_id ( kebele_number, kebele_name_am, kebele_name_en )`,
          )
          .eq("household_id", householdId as string)
          .maybeSingle(),
        supabase
          .from("resident")
          .select("resident_id, full_name, full_name_am, relation_to_head, sex, residency_status")
          .eq("current_household_id", householdId as string)
          .eq("woreda_id", woredaId as string)
          .order("full_name_am"),
      ]);
      if (hh.error) throw hh.error;
      if (members.error) throw members.error;
      return { household: hh.data, members: members.data ?? [] };
    },
  });

  const [memberFilter, setMemberFilter] = useState("all");

  const headId =
    (q.data?.household as { household_head_resident_id?: string | null } | null)
      ?.household_head_resident_id ?? null;
  const members = useMemo(() => {
    const all = q.data?.members ?? [];
    if (memberFilter === "all") return all;
    if (memberFilter === "head") return all.filter((m) => m.resident_id === headId);
    if (memberFilter === "resident")
      return all.filter(
        (m) => m.residency_status === "resident" || m.residency_status === "permanent",
      );
    return all.filter(
      (m) =>
        m.resident_id !== headId &&
        m.residency_status !== "resident" &&
        m.residency_status !== "permanent",
    );
  }, [q.data, memberFilter, headId]);

  if (!householdId) {
    return (
      <Card className="p-5">
        <PanelHeading icon={Home} am="ቤተሰብ" en="Household" />
        <EmptyState am="ይህ ነዋሪ ገና ወደ ቤተሰብ አልተመደበም" en="Not assigned to a household" />
      </Card>
    );
  }
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;

  const hh = q.data?.household as
    | (Record<string, unknown> & {
        kebele?: {
          kebele_number?: string | null;
          kebele_name_am?: string | null;
        } | null;
      })
    | null
    | undefined;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <PanelHeading
          icon={Home}
          am="የቤተሰብ መረጃ"
          en="Household Details"
          action={
            <Link
              to="/woreda/households/$householdId"
              params={{ householdId }}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open household
            </Link>
          }
        />
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row am="የቤት ቁጥር" en="House Number" value={(hh?.house_number as string) || "—"} />
          <Row
            am="ቀበሌ"
            en="Kebele"
            value={
              hh?.kebele
                ? `ቀበሌ ${hh.kebele.kebele_number ?? "—"}${hh.kebele.kebele_name_am ? ` — ${hh.kebele.kebele_name_am}` : ""}`
                : "—"
            }
          />
          <Row am="የቤት አይነት" en="House Type" value={(hh?.house_type as string) || "—"} />
          <Row am="የመኖሪያ ሁኔታ" en="Occupancy" value={(hh?.occupancy_status as string) || "—"} />
          <Row am="አድራሻ" en="Address" value={(hh?.address_line as string) || "—"} />
          <Row am="ስልክ" en="Phone" value={(hh?.phone_number as string) || "—"} />
        </dl>
      </Card>

      <Card className="p-5">
        <PanelHeading icon={Users} am="የቤተሰብ አባላት" en="Members" count={members.length} />
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50/70 p-3">
          <ChipRow
            labelAm="የአባል አይነት"
            labelEn="Member type"
            value={memberFilter}
            onChange={setMemberFilter}
            options={[
              { value: "all", am: "ሁሉም", en: "All" },
              { value: "head", am: "የቤተሰብ ኃላፊ", en: "Head" },
              { value: "resident", am: "ነዋሪ", en: "Resident" },
              { value: "non_resident", am: "ሌላ", en: "Other" },
            ]}
          />
        </div>
        {members.length === 0 ? (
          <EmptyState am="አባል አልተገኘም" en="No members match" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {members.map((m) => (
              <li key={m.resident_id}>
                <Link
                  to="/woreda/residents/$residentId"
                  params={{ residentId: m.resident_id }}
                  search={{ tab: "overview" }}
                  className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-blue-50/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-noto-ethiopic truncate text-sm font-medium text-slate-900">
                      {m.full_name_am || m.full_name || "—"}
                      {m.resident_id === residentId && (
                        <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                          This resident
                        </span>
                      )}
                    </div>
                    <div className="font-noto-ethiopic truncate text-xs text-slate-500">
                      {m.relation_to_head || "—"}
                    </div>
                  </div>
                  <StatusChip status={m.residency_status as string} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Civil events tab ---------------- */

export function CivilEventsTab({
  residentId,
  woredaId,
}: {
  residentId: string;
  woredaId: string | null;
}) {
  const q = useQuery({
    queryKey: ["resident-tab-civil", residentId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vital_event")
        .select("vital_event_id, event_type, event_number, event_date, status, registration_date")
        .eq("resident_id", residentId)
        .eq("woreda_id", woredaId as string)
        .order("event_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [range, setRange] = useState("all");
  const [type, setType] = useState("all");

  const rows = useMemo(
    () =>
      (q.data ?? []).filter(
        (e) => (type === "all" || e.event_type === type) && inRange(e.event_date, range),
      ),
    [q.data, range, type],
  );

  if (q.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card className="p-5">
      <PanelHeading icon={FileText} am="የኩነት ምዝገባ" en="Civil Events" count={rows.length} />
      <FilterBar
        range={range}
        onRangeChange={setRange}
        typeLabelAm="የኩነት አይነት"
        typeLabelEn="Event type"
        type={type}
        onTypeChange={setType}
        typeOptions={[
          { value: "all", am: "ሁሉም", en: "All" },
          { value: "birth", am: "ልደት", en: "Birth" },
          { value: "death", am: "ሞት", en: "Death" },
          { value: "marriage", am: "ጋብቻ", en: "Marriage" },
          { value: "divorce", am: "ፍቺ", en: "Divorce" },
        ]}
        resultCount={rows.length}
      />
      {rows.length === 0 ? (
        <EmptyState am="ምንም የኩነት መዝገብ አልተገኘም" en="No civil events match" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((e) => (
            <li key={e.vital_event_id}>
              <Link
                to="/woreda/civil/$eventId"
                params={{ eventId: e.vital_event_id }}
                className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-blue-50/40"
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-blue-50 text-blue-700">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium capitalize text-slate-900">
                    {e.event_type}
                  </div>
                  <div className="truncate font-mono text-xs text-slate-500">{e.event_number}</div>
                </div>
                <div className="hidden text-xs text-slate-500 sm:block">
                  {dateLabel(e.event_date)}
                </div>
                <StatusChip status={e.status as string} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------- Credentials tab ---------------- */

export function CredentialsTab({
  residentId,
  woredaId,
}: {
  residentId: string;
  woredaId: string | null;
}) {
  const q = useQuery({
    queryKey: ["resident-tab-credentials", residentId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const [creds, reqs] = await Promise.all([
        supabase
          .from("residence_credential")
          .select(
            "credential_id, credential_number, credential_type, status, issue_date, expiry_date, credential_request_id",
          )
          .eq("resident_id", residentId)
          .eq("woreda_id", woredaId as string)
          .order("created_at", { ascending: false }),
        supabase
          .from("credential_request")
          .select(
            "credential_request_id, request_number, request_type, credential_type, status, created_at",
          )
          .eq("resident_id", residentId)
          .eq("woreda_id", woredaId as string)
          .order("created_at", { ascending: false }),
      ]);
      if (creds.error) throw creds.error;
      if (reqs.error) throw reqs.error;
      return { creds: creds.data ?? [], reqs: reqs.data ?? [] };
    },
  });

  const [range, setRange] = useState("all");
  const [kind, setKind] = useState("all");

  const creds = useMemo(
    () =>
      (q.data?.creds ?? []).filter(
        (c) => (kind === "all" || kind === "credentials") && inRange(c.issue_date, range),
      ),
    [q.data, range, kind],
  );
  const reqs = useMemo(
    () =>
      (q.data?.reqs ?? []).filter(
        (r) => (kind === "all" || kind === "requests") && inRange(r.created_at as string, range),
      ),
    [q.data, range, kind],
  );

  if (q.isLoading) return <Skeleton className="h-56 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <FilterBar
          range={range}
          onRangeChange={setRange}
          typeLabelAm="የመዝገብ አይነት"
          typeLabelEn="Record type"
          type={kind}
          onTypeChange={setKind}
          typeOptions={[
            { value: "all", am: "ሁሉም", en: "All" },
            { value: "credentials", am: "የተሰጡ", en: "Issued" },
            { value: "requests", am: "ጥያቄዎች", en: "Requests" },
          ]}
          resultCount={creds.length + reqs.length}
        />
      </Card>

      <Card className="p-5">
        <PanelHeading
          icon={CreditCard}
          am="የተሰጡ ማስረጃዎች"
          en="Issued Credentials"
          count={creds.length}
        />
        {creds.length === 0 ? (
          <EmptyState am="ማስረጃ አልተገኘም" en="No credentials match" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {creds.map((c) => (
              <li key={c.credential_id} className="flex items-center gap-3 px-2 py-3">
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-blue-50 text-blue-700">
                  <CreditCard className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm font-medium text-slate-900">
                    {c.credential_number}
                  </div>
                  <div className="text-xs capitalize text-slate-500">
                    {c.credential_type} · issued {dateLabel(c.issue_date)}
                  </div>
                </div>
                <div className="hidden text-xs text-slate-500 sm:block">
                  exp. {dateLabel(c.expiry_date)}
                </div>
                <StatusChip status={c.status as string} />
                {c.credential_request_id && (
                  <Link
                    to="/woreda/credentials/$requestId"
                    params={{ requestId: c.credential_request_id }}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <PanelHeading
          icon={FileText}
          am="የማስረጃ ጥያቄዎች"
          en="Credential Requests"
          count={reqs.length}
        />
        {reqs.length === 0 ? (
          <EmptyState am="ጥያቄ አልተገኘም" en="No requests match" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {reqs.map((rq) => (
              <li key={rq.credential_request_id}>
                <Link
                  to="/woreda/credentials/$requestId"
                  params={{ requestId: rq.credential_request_id }}
                  className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-blue-50/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm font-medium text-slate-900">
                      {rq.request_number}
                    </div>
                    <div className="text-xs capitalize text-slate-500">
                      {rq.request_type} · {rq.credential_type}
                    </div>
                  </div>
                  <div className="hidden text-xs text-slate-500 sm:block">
                    {dateLabel(rq.created_at)}
                  </div>
                  <StatusChip status={rq.status as string} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Activity log tab ---------------- */

const ACTION_LABEL_AM: Record<string, string> = {
  insert: "ተመዝግቧል",
  create: "ተመዝግቧል",
  update: "ተሻሽሏል",
  delete: "ተሰርዟል",
  status_change: "ሁኔታ ተቀይሯል",
};

export function ActivityTab({
  residentId,
  woredaId,
}: {
  residentId: string;
  woredaId: string | null;
}) {
  const q = useQuery({
    queryKey: ["resident-tab-activity", residentId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("audit_log_id, action_type, action_at, entity_name, actor_user_id")
        .eq("entity_id", residentId)
        .order("action_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [range, setRange] = useState("90");
  const [action, setAction] = useState("all");

  const rows = useMemo(
    () =>
      (q.data ?? []).filter((row) => {
        const a = String(row.action_type ?? "").toLowerCase();
        const matchesAction =
          action === "all" ||
          (action === "create" && (a.includes("insert") || a.includes("create"))) ||
          (action === "update" && (a.includes("update") || a.includes("edit"))) ||
          (action === "status" &&
            (a.includes("status") || a.includes("suspend") || a.includes("activat")));
        return matchesAction && inRange(row.action_at as string, range);
      }),
    [q.data, range, action],
  );

  if (q.isLoading) return <Skeleton className="h-56 w-full" />;

  return (
    <Card className="p-5">
      <PanelHeading icon={Activity} am="እንቅስቃሴ" en="Activity Log" count={rows.length} />
      <FilterBar
        range={range}
        onRangeChange={setRange}
        typeLabelAm="የተግባር አይነት"
        typeLabelEn="Action"
        type={action}
        onTypeChange={setAction}
        typeOptions={[
          { value: "all", am: "ሁሉም", en: "All" },
          { value: "create", am: "ተመዝግቧል", en: "Created" },
          { value: "update", am: "ተሻሽሏል", en: "Updated" },
          { value: "status", am: "ሁኔታ", en: "Status" },
        ]}
        resultCount={rows.length}
      />
      {rows.length === 0 ? (
        <EmptyState am="በዚህ ማጣሪያ ምንም እንቅስቃሴ የለም" en="No activity matches the filters" />
      ) : (
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {rows.map((row) => (
            <li key={row.audit_log_id} className="relative">
              <span className="absolute -left-[26px] top-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-blue-600 ring-2 ring-white" />
              <div className="font-noto-ethiopic text-sm font-medium text-slate-900">
                {ACTION_LABEL_AM[row.action_type as string] ?? row.action_type}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {row.entity_name}
                </span>
                <span>·</span>
                <span>{dateLabel(row.action_at as string)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Row({ am, en, value }: { am: string; en: string; value: string }) {
  return (
    <div>
      <dt className="font-noto-ethiopic text-xs text-slate-500">
        {am} <span className="text-slate-400">/ {en}</span>
      </dt>
      <dd className="font-noto-ethiopic text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}
