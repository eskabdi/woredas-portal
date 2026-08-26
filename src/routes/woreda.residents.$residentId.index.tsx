import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  CalendarClock,
  CreditCard,
  Edit3,
  ExternalLink,
  FileText,
  Home,
  IdCard,
  Mail,
  MapPin,
  MapPinOff,
  Phone,
  Printer,
  Share2,
  User,
  UserPlus,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusChip } from "@/components/common/StatusChip";
import { PermissionGate } from "@/components/common/PermissionGate";
import {
  AddToHouseholdDialog,
  ResidentActions,
  type ActionResident,
} from "@/components/residents/ResidentActions";
import {
  ActivityTab,
  CivilEventsTab,
  CredentialsTab,
  DocumentsTab,
  HouseholdTab,
} from "@/components/residents/ResidentProfileTabs";

import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { formatEthiopianDate, formatEthiopianDateOnly } from "@/utils/ethiopianCalendar";
import { EDUCATION_OPTIONS, OCCUPATION_OPTIONS } from "@/lib/residentConstants";

const LocationDisplayMap = lazy(() => import("@/components/gis/LocationDisplayMap"));

type TabKey = "overview" | "household" | "civil" | "credentials" | "documents" | "activity";
const VALID_TABS: TabKey[] = [
  "overview",
  "household",
  "civil",
  "credentials",
  "documents",
  "activity",
];

interface TabSearch {
  tab?: TabKey;
}

export const Route = createFileRoute("/woreda/residents/$residentId/")({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): TabSearch => {
    const t = raw.tab;
    return { tab: VALID_TABS.includes(t as TabKey) ? (t as TabKey) : "overview" };
  },
  component: ResidentProfilePage,
});

interface KebeleShape {
  kebele_id: string;
  kebele_number: string | null;
  kebele_name_am: string | null;
  kebele_name_en: string | null;
}

interface HouseholdShape {
  household_id: string;
  house_number: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  kebele: KebeleShape | null;
}

interface BirthPlace {
  place_name?: string;
  region?: string;
  zone?: string;
  woreda?: string;
  kebele?: string;
  house_number?: string;
  area_name?: string;
}

interface WorkInfo {
  education_level?: string;
  occupation_status?: string;
  occupation_post?: string;
  work_address?: string;
}

interface CurrentResidenceExtra {
  latitude?: number;
  longitude?: number;
  sub_woreda?: string;
  other_address?: string;
}

function ResidentProfilePage() {
  const { residentId } = Route.useParams();
  const { tab } = useSearch({ from: "/woreda/residents/$residentId/" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);

  const [addHouseholdOpen, setAddHouseholdOpen] = useState(false);

  const residentQuery = useQuery({
    queryKey: ["resident-detail", residentId, woredaId],
    enabled: !!woredaId && hasPermission(P.RESIDENT_READ),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select(
          `*,
           household:current_household_id (
             household_id, house_number, gps_lat, gps_lng,
             kebele:kebele_id ( kebele_id, kebele_number, kebele_name_am, kebele_name_en )
           )`,
        )
        .eq("resident_id", residentId)
        .eq("woreda_id", woredaId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const householdId = residentQuery.data?.current_household_id ?? null;

  const householdMembersQuery = useQuery({
    queryKey: ["resident-household-members", householdId, residentId],
    enabled: !!householdId && !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select("resident_id, full_name, full_name_am, relation_to_head, photo_url")
        .eq("current_household_id", householdId as string)
        .eq("woreda_id", woredaId as string)
        .neq("resident_id", residentId)
        .order("full_name_am");
      if (error) throw error;
      return data ?? [];
    },
  });

  const credentialCountQuery = useQuery({
    queryKey: ["resident-credential-count", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("residence_credential")
        .select("credential_id", { count: "exact", head: true })
        .eq("resident_id", residentId)
        .eq("status", "active");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const recentActivityQuery = useQuery({
    queryKey: ["resident-recent-activity", residentId],
    enabled: !!residentId && !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("audit_log_id, action_type, action_at, actor_user_id")
        .eq("entity_name", "resident")
        .eq("entity_id", residentId)
        .order("action_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  // resident.photo_url and household-member photo_url are storage paths, not
  // public URLs -- resident-photos is a private bucket, so every image needs a
  // signed URL (same pattern as woreda.credentials.$requestId.print.tsx).
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const headResidentPhotoPath = residentQuery.data?.photo_url as string | null | undefined;
  useEffect(() => {
    let cancelled = false;
    if (!headResidentPhotoPath) {
      setPhotoUrl(null);
      return;
    }
    supabase.storage
      .from("resident-photos")
      .createSignedUrl(headResidentPhotoPath, 900)
      .then(({ data }) => {
        if (!cancelled) setPhotoUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [headResidentPhotoPath]);

  const [memberPhotoUrls, setMemberPhotoUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const withPhotos = (householdMembersQuery.data ?? []).filter((m) => m.photo_url);
    if (withPhotos.length === 0) {
      setMemberPhotoUrls({});
      return;
    }
    Promise.all(
      withPhotos.map(async (m) => {
        const { data } = await supabase.storage
          .from("resident-photos")
          .createSignedUrl(m.photo_url as string, 900);
        return [m.resident_id, data?.signedUrl ?? null] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [id, url] of entries) if (url) map[id] = url;
      setMemberPhotoUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [householdMembersQuery.data]);

  if (!hasPermission(P.RESIDENT_READ)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
        <p className="text-sm">You don't have permission to view this page.</p>
      </div>
    );
  }

  if (residentQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (residentQuery.error || !residentQuery.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-noto-ethiopic font-medium">ነዋሪ አልተገኘም / Resident not found</p>
        <Button variant="link" onClick={() => navigate({ to: "/woreda/residents" })}>
          ← Back to list
        </Button>
      </div>
    );
  }

  const r = residentQuery.data;
  const household = r.household as unknown as HouseholdShape | null;
  const kebele = household?.kebele ?? null;
  const birthPlace = (r.birth_place as BirthPlace | null) ?? null;
  const workInfo = (r.work_info as WorkInfo | null) ?? null;
  const residenceExtra = (r.current_residence_extra as CurrentResidenceExtra | null) ?? null;

  const name = r.full_name_am || r.full_name || "—";
  const initials = getInitials(name);
  const statusForChip = r.active_flag === false ? "inactive" : (r.residency_status as string);

  const kebeleLabel = kebele
    ? `ቀበሌ ${kebele.kebele_number ?? "—"}${kebele.kebele_name_am ? ` — ${kebele.kebele_name_am}` : ""}`
    : "—";

  const actionResident: ActionResident = {
    resident_id: r.resident_id,
    full_name: r.full_name,
    full_name_am: r.full_name_am,
    residency_status: r.residency_status,
    active_flag: r.active_flag,
    current_household_id: r.current_household_id,
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["resident-detail", residentId] });
    queryClient.invalidateQueries({ queryKey: ["residents"] });
    queryClient.invalidateQueries({ queryKey: ["resident-household-members"] });
    queryClient.invalidateQueries({ queryKey: ["resident-recent-activity", residentId] });
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("አገናኝ ተቀድቷል / Link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const setTab = (next: TabKey) => {
    navigate({
      to: "/woreda/residents/$residentId",
      params: { residentId },
      search: { tab: next },
    });
  };

  const gpsLat = typeof household?.gps_lat === "number" ? household.gps_lat : null;
  const gpsLng = typeof household?.gps_lng === "number" ? household.gps_lng : null;

  return (
    <div className="space-y-6 pb-12">
      {/* HEADER (blue) */}
      <div className="rounded-lg bg-blue-700 px-5 py-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={name}
                className="h-16 w-16 rounded-full object-cover ring-2 ring-white/40"
              />
            ) : (
              <div className="font-noto-ethiopic flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-xl font-semibold ring-2 ring-white/25">
                {initials}
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-noto-ethiopic truncate text-xl font-semibold">{name}</h1>
                <StatusChip status={statusForChip} />
              </div>
              {r.full_name_am && r.full_name && (
                <p className="text-sm text-blue-100">{r.full_name}</p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-100">
                <span className="inline-flex items-center gap-1">
                  <IdCard className="h-3.5 w-3.5" />
                  <span className="font-mono">ID: {r.resident_number}</span>
                </span>
                <span className="inline-flex items-center gap-1 font-noto-ethiopic">
                  <MapPin className="h-3.5 w-3.5" />
                  {kebeleLabel}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              size="sm"
              onClick={() =>
                navigate({ to: "/woreda/residents/$residentId/print", params: { residentId } })
              }
              className="bg-white text-blue-700 hover:bg-blue-50"
            >
              <Printer className="mr-2 h-4 w-4" />
              <span className="font-noto-ethiopic">አትም</span>
              <span className="ml-1 opacity-80">/ Print</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleShare}
              aria-label="Share"
              className="h-9 w-9 text-white hover:bg-white/15"
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <ResidentActions
              resident={actionResident}
              woredaId={woredaId as string}
              actorUserId={actorUserId}
              onChanged={invalidateAll}
              variant="header"
              showView={false}
            />
          </div>
        </div>
      </div>

      {/* SUMMARY STRIP */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Home}
          labelAm="የቤት ቁጥር"
          labelEn="House Number"
          primary={household?.house_number || "—"}
          secondary={kebele?.kebele_name_am ?? undefined}
        />
        <SummaryCard
          icon={CreditCard}
          labelAm="የተሰጡ ማስረጃዎች"
          labelEn="Issued Credentials"
          primary={String(credentialCountQuery.data ?? 0)}
          secondary="Active"
        />
        <SummaryCard
          icon={CalendarClock}
          labelAm="መጨረሻ የተሻሻለበት"
          labelEn="Last Updated"
          primary={r.updated_at ? formatEthiopianDate(new Date(r.updated_at)) : "—"}
          secondary={r.updated_at ? new Date(r.updated_at).toLocaleDateString() : undefined}
        />
      </div>

      {/* TABS */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg bg-slate-100 p-1">
          <TabRow value="overview" am="አጠቃላይ" en="Overview" />
          <TabRow value="household" am="ቤተሰብ" en="Household" />
          <TabRow value="civil" am="የኩነት ምዝገባ" en="Civil Events" />
          <TabRow value="credentials" am="ማስረጃዎች" en="Credentials" />
          <TabRow value="documents" am="ሰነዶች" en="Documents" />
          <TabRow value="activity" am="እንቅስቃሴ" en="Activity Log" />
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* MAIN COLUMN */}
            <div className="space-y-4 lg:col-span-2">
              {/* Card 1 — Personal Details */}
              <Card className="p-5">
                <CardHeading icon={User} am="የግል መረጃ" en="Personal Details" />
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field
                    labelAm="የትውልድ ቀን"
                    labelEn="Date of Birth"
                    value={
                      r.date_of_birth ? formatEthiopianDateOnly(r.date_of_birth) : notRecorded()
                    }
                  />
                  <Field
                    labelAm="የትውልድ ቦታ"
                    labelEn="Place of Birth"
                    value={formatBirthPlace(birthPlace)}
                  />
                  <Field
                    labelAm="ጾታ"
                    labelEn="Gender"
                    value={
                      r.sex === "male"
                        ? "ወንድ / Male"
                        : r.sex === "female"
                          ? "ሴት / Female"
                          : (r.sex as string) || notRecorded()
                    }
                  />
                  <Field labelAm="ብሔር" labelEn="Ethnicity" value={r.ethnicity || notRecorded()} />
                </dl>
              </Card>

              {/* Card 2 — Contact */}
              <Card className="p-5">
                <CardHeading icon={Phone} am="ግንኙነት" en="Contact Information" />
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field
                    labelAm="ስልክ"
                    labelEn="Phone"
                    icon={Phone}
                    value={r.phone_number || notRecorded()}
                    mono
                  />
                  <Field
                    labelAm="ኢሜይል"
                    labelEn="Email"
                    icon={Mail}
                    value={r.email || notRecorded()}
                  />
                  <Field labelAm="ስራ" labelEn="Occupation" value={formatOccupation(workInfo)} />
                  <Field labelAm="ትምህርት" labelEn="Education" value={formatEducation(workInfo)} />
                </dl>
              </Card>

              {/* Card 4 — Recent Activities */}
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <CardHeading
                    icon={Activity}
                    am="የቅርብ ጊዜ እንቅስቃሴዎች"
                    en="Recent Activities"
                    inline
                  />
                  <button
                    type="button"
                    onClick={() => setTab("activity")}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    <span className="font-noto-ethiopic">ሁሉንም አሳይ</span>
                    <span className="ml-1 text-slate-500">/ View All</span>
                  </button>
                </div>
                {recentActivityQuery.isLoading && (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                )}
                {!recentActivityQuery.isLoading &&
                  (recentActivityQuery.data?.length ?? 0) === 0 && (
                    <p className="font-noto-ethiopic rounded-md border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                      እስካሁን ምንም እንቅስቃሴ የለም
                      <span className="ml-1 text-xs text-slate-400">/ No activity yet</span>
                    </p>
                  )}
                {(recentActivityQuery.data?.length ?? 0) > 0 && (
                  <ul className="divide-y divide-slate-100">
                    {recentActivityQuery.data!.map((row) => (
                      <li key={row.audit_log_id} className="flex items-center gap-3 py-2.5">
                        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue-50 text-blue-700">
                          <Activity className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-noto-ethiopic truncate text-sm font-medium text-slate-900">
                            {actionLabelAm(row.action_type as string)}
                          </div>
                          <div className="truncate text-xs text-slate-500">{row.action_type}</div>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          {formatRelative(row.action_at as string)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Card 5 — Household Members */}
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-blue-700" />
                    <h3 className="font-noto-ethiopic text-base font-semibold text-slate-900">
                      የቤተሰብ አባላት <span className="text-slate-400">/ Household Members</span>
                    </h3>
                    <span className="ml-1 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {householdMembersQuery.data?.length ?? 0}
                    </span>
                  </div>
                  {householdId && (
                    <MemberAddDropdown
                      onAttach={() => setAddHouseholdOpen(true)}
                      onRegisterNew={() =>
                        navigate({
                          to: "/woreda/residents/new",
                          search: { householdId } as never,
                        })
                      }
                    />
                  )}
                </div>

                {!householdId && (
                  <div className="rounded-md border border-dashed border-slate-200 px-4 py-6 text-center">
                    <p className="font-noto-ethiopic text-sm text-slate-700">
                      ይህ ነዋሪ ገና ወደ ቤተሰብ አልተመደበም
                    </p>
                    <p className="text-xs text-slate-500">Not yet assigned to a household</p>
                    <PermissionGate permission={P.RESIDENT_UPDATE}>
                      <Button
                        onClick={() => setAddHouseholdOpen(true)}
                        className="mt-3 bg-blue-700 text-white hover:bg-blue-800"
                        size="sm"
                      >
                        <UserPlus className="mr-2 h-4 w-4" />
                        <span className="font-noto-ethiopic">ወደ ቤተሰብ ጨምር</span>
                        <span className="ml-2 opacity-80">/ Add to Household</span>
                      </Button>
                    </PermissionGate>
                  </div>
                )}

                {householdId && householdMembersQuery.isLoading && (
                  <Skeleton className="h-16 w-full" />
                )}

                {householdId &&
                  !householdMembersQuery.isLoading &&
                  (householdMembersQuery.data?.length ?? 0) === 0 && (
                    <p className="font-noto-ethiopic text-sm text-slate-500">
                      በዚህ ቤት ውስጥ ሌላ አባል የለም / No other members in this household
                    </p>
                  )}

                {(householdMembersQuery.data?.length ?? 0) > 0 && (
                  <ul className="divide-y divide-slate-100">
                    {householdMembersQuery.data!.map((m) => {
                      const mname = m.full_name_am || m.full_name || "—";
                      return (
                        <li key={m.resident_id}>
                          <Link
                            to="/woreda/residents/$residentId"
                            params={{ residentId: m.resident_id }}
                            search={{ tab: "overview" }}
                            className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-blue-50/40"
                          >
                            {memberPhotoUrls[m.resident_id] ? (
                              <img
                                src={memberPhotoUrls[m.resident_id]}
                                alt={mname}
                                className="h-9 w-9 flex-none rounded-full object-cover"
                              />
                            ) : (
                              <div className="font-noto-ethiopic flex h-9 w-9 flex-none items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                                {getInitials(mname)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="font-noto-ethiopic truncate text-sm font-medium text-slate-900">
                                {mname}
                              </div>
                              <div className="font-noto-ethiopic truncate text-xs text-slate-500">
                                {m.relation_to_head || "—"}
                              </div>
                            </div>
                            <ExternalLink className="h-4 w-4 text-slate-400" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              {/* Card 6 — Registered Location */}
              <Card className="p-5">
                <CardHeading icon={MapPin} am="የተመዘገበበት አካባቢ" en="Registered Location" />
                {gpsLat != null && gpsLng != null ? (
                  <Suspense fallback={<Skeleton className="h-[220px] w-full" />}>
                    <LocationDisplayMap latitude={gpsLat} longitude={gpsLng} label={name} />
                  </Suspense>
                ) : (
                  <div className="flex flex-col items-center rounded-md border border-dashed border-slate-200 px-4 py-8 text-center">
                    <MapPinOff className="mb-2 h-6 w-6 text-slate-400" />
                    <p className="font-noto-ethiopic text-sm text-slate-700">የመገኛ አካባቢ አልተመዘገበም</p>
                    <p className="text-xs text-slate-500">No GPS location recorded</p>
                  </div>
                )}
              </Card>
            </div>

            {/* RAIL */}
            <div className="space-y-4">
              {/* Card 3 — Quick Actions (dark) */}
              <div className="rounded-xl bg-slate-900 p-5 text-white shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
                    <IdCard className="h-4 w-4" />
                  </div>
                  <h3 className="font-noto-ethiopic text-base font-semibold">
                    ፈጣን ተግባራት <span className="text-slate-400">/ Quick Actions</span>
                  </h3>
                </div>
                <div className="space-y-2">
                  <QuickAction
                    permission={P.CREDENTIAL_ISSUE}
                    icon={CreditCard}
                    am="የመታወቂያ ጥያቄ"
                    en="ID Request"
                    onClick={() =>
                      navigate({
                        to: "/woreda/credentials/new",
                        search: { residentId },
                      })
                    }
                  />
                  <QuickAction
                    permission={P.SERVICE_CREATE}
                    icon={FileText}
                    am="አገልግሎት ጥያቄ"
                    en="Service Request"
                    onClick={() =>
                      navigate({
                        to: "/woreda/services/new",
                        search: { residentId },
                      })
                    }
                  />
                  <QuickAction
                    permission={P.CIVIL_REGISTER}
                    icon={CalendarClock}
                    am="የኩነት ምዝገባ"
                    en="Civil Event"
                    onClick={() => navigate({ to: "/woreda/civil" })}
                  />
                  <QuickAction
                    permission={P.RESIDENT_UPDATE}
                    icon={Edit3}
                    am="የነዋሪው መረጃ አሻሽል"
                    en="Update Profile"
                    onClick={() =>
                      navigate({
                        to: "/woreda/residents/$residentId/edit",
                        params: { residentId },
                      })
                    }
                  />
                  <QuickAction
                    permission={P.RESIDENT_READ}
                    icon={Printer}
                    am="የነዋሪው ማህደር አትም"
                    en="Print Profile"
                    onClick={() =>
                      navigate({
                        to: "/woreda/residents/$residentId/print",
                        params: { residentId },
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="household" className="mt-4">
          <HouseholdTab residentId={residentId} woredaId={woredaId} householdId={householdId} />
        </TabsContent>
        <TabsContent value="civil" className="mt-4">
          <CivilEventsTab residentId={residentId} woredaId={woredaId} />
        </TabsContent>
        <TabsContent value="credentials" className="mt-4">
          <CredentialsTab residentId={residentId} woredaId={woredaId} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab
            residentId={residentId}
            woredaId={woredaId}
            householdId={householdId}
            actorUserId={actorUserId}
            canUpload={hasPermission(P.RESIDENT_UPDATE)}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab residentId={residentId} woredaId={woredaId} />
        </TabsContent>
      </Tabs>

      {/* Add to Household modal (opens from members card / empty state) */}
      <PermissionGate permission={P.RESIDENT_UPDATE}>
        <AddToHouseholdDialog
          open={addHouseholdOpen}
          onClose={() => setAddHouseholdOpen(false)}
          resident={actionResident}
          woredaId={woredaId as string}
          actorUserId={actorUserId}
          onChanged={invalidateAll}
        />
      </PermissionGate>
    </div>
  );
}

/* ---------- helpers & subcomponents ---------- */

function TabRow({ value, am, en }: { value: TabKey; am: string; en: string }) {
  return (
    <TabsTrigger value={value} className="flex-none">
      <span className="font-noto-ethiopic">{am}</span>
      <span className="ml-1.5 text-xs text-slate-500">/ {en}</span>
    </TabsTrigger>
  );
}

function SummaryCard({
  icon: Icon,
  labelAm,
  labelEn,
  primary,
  secondary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  labelAm: string;
  labelEn: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-blue-50 text-blue-700">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="font-noto-ethiopic truncate text-xs text-slate-500">
            {labelAm} <span className="text-slate-400">/ {labelEn}</span>
          </div>
          <div className="font-noto-ethiopic truncate text-base font-semibold text-slate-900">
            {primary}
          </div>
          {secondary && (
            <div className="font-noto-ethiopic truncate text-xs text-slate-500">{secondary}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

function CardHeading({
  icon: Icon,
  am,
  en,
  inline,
}: {
  icon: React.ComponentType<{ className?: string }>;
  am: string;
  en: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "flex items-center gap-2" : "mb-4 flex items-center gap-2"}>
      <Icon className="h-4 w-4 text-blue-700" />
      <h3 className="font-noto-ethiopic text-base font-semibold text-slate-900">
        {am} <span className="text-slate-400">/ {en}</span>
      </h3>
    </div>
  );
}

function Field({
  labelAm,
  labelEn,
  value,
  icon: Icon,
  mono,
}: {
  labelAm: string;
  labelEn: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="font-noto-ethiopic text-xs uppercase tracking-wide text-slate-500">
        {labelAm} <span className="text-slate-400">/ {labelEn}</span>
      </dt>
      <dd
        className={`mt-0.5 flex items-center gap-1.5 text-sm text-slate-900 ${
          mono ? "font-mono" : "font-noto-ethiopic"
        }`}
      >
        {Icon && <Icon className="h-3.5 w-3.5 text-slate-400" />}
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}

function notRecorded() {
  return (
    <span className="font-noto-ethiopic text-slate-400">
      አልተመዘገበም <span className="text-slate-300">/ Not recorded</span>
    </span>
  );
}

function formatBirthPlace(bp: BirthPlace | null): React.ReactNode {
  if (!bp) return notRecorded();
  if (bp.place_name && bp.place_name.trim()) return bp.place_name;
  const parts = [bp.kebele, bp.woreda].filter((x): x is string => !!x && x.trim().length > 0);
  if (parts.length) return parts.join(", ");
  return notRecorded();
}

function formatOccupation(wi: WorkInfo | null): React.ReactNode {
  if (!wi) return notRecorded();
  if (wi.occupation_post && wi.occupation_post.trim()) return wi.occupation_post;
  if (wi.occupation_status) {
    const opt = OCCUPATION_OPTIONS.find((o) => o.value === wi.occupation_status);
    if (opt) return `${opt.am} / ${opt.en}`;
    return wi.occupation_status;
  }
  return notRecorded();
}

function formatEducation(wi: WorkInfo | null): React.ReactNode {
  if (!wi?.education_level) return notRecorded();
  const opt = EDUCATION_OPTIONS.find((o) => o.value === wi.education_level);
  if (opt) return `${opt.am} / ${opt.en}`;
  return wi.education_level;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
}

const AM_ACTION_LABELS: Record<string, string> = {
  RESIDENT_CREATED: "ነዋሪ ተመዝግቧል",
  RESIDENT_UPDATED: "መረጃ ተሻሽሏል",
  RESIDENT_SUSPENDED: "ነዋሪ ታግዷል",
  RESIDENT_REACTIVATED: "ነዋሪ ዳግም ነቅቷል",
  RESIDENT_DEACTIVATED: "ወደ ኢ-ንቁ ተቀይሯል",
  RESIDENT_ACTIVATED: "ወደ ንቁ ተመልሷል",
  HOUSEHOLD_ASSIGNED: "ወደ ቤተሰብ ተጨምሯል",
};

function actionLabelAm(action: string): string {
  return AM_ACTION_LABELS[action] || action.replaceAll("_", " ").toLowerCase();
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "አሁን / just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function QuickAction({
  permission,
  icon: Icon,
  am,
  en,
  onClick,
}: {
  permission: (typeof P)[keyof typeof P];
  icon: React.ComponentType<{ className?: string }>;
  am: string;
  en: string;
  onClick: () => void;
}) {
  return (
    <PermissionGate permission={permission}>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-white/10"
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-white/10 text-white">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="font-noto-ethiopic block truncate text-sm font-medium">{am}</span>
            <span className="block truncate text-xs text-slate-400">/ {en}</span>
          </span>
        </span>
        <ExternalLink className="h-4 w-4 flex-none text-slate-500 group-hover:text-white" />
      </button>
    </PermissionGate>
  );
}

function MemberAddDropdown({
  onAttach,
  onRegisterNew,
}: {
  onAttach: () => void;
  onRegisterNew: () => void;
}) {
  return (
    <PermissionGate permission={P.RESIDENT_UPDATE}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            <UserPlus className="mr-1.5 h-4 w-4" />
            <span className="font-noto-ethiopic">ተጨማሪ አባል ጨምር</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onClick={onAttach}>
            <span className="font-noto-ethiopic">ነባር ነዋሪ አክል</span>
            <span className="ml-2 text-xs text-slate-500">/ Attach Existing</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRegisterNew}>
            <span className="font-noto-ethiopic">አዲስ ነዋሪ መዝግብ</span>
            <span className="ml-2 text-xs text-slate-500">/ Register New</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PermissionGate>
  );
}

function PlaceholderPanel() {
  return (
    <Card className="p-10 text-center">
      <p className="font-noto-ethiopic text-sm text-slate-700">
        በቅርቡ ይሟላል <span className="text-slate-400">/ Details coming in the next update</span>
      </p>
    </Card>
  );
}
