import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useReactToPrint } from "react-to-print";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { toast } from "sonner";
import {
  Home,
  MoreVertical,
  Edit,
  MapPin,
  Users,
  Phone,
  Crown,
  Printer,
  FileDown,
  FileText,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusChip } from "@/components/common/StatusChip";
import { PageHeader } from "@/components/common/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";
import { ErrorState } from "@/components/residents/ResidentProfileTabs";

const LocationDisplayMap = lazy(() => import("@/components/gis/LocationDisplayMap"));
const DocumentViewerDialog = lazy(() => import("@/components/common/DocumentViewerDialog"));

type TabKey = "overview" | "documents";
const VALID_TABS: TabKey[] = ["overview", "documents"];

interface TabSearch {
  tab?: TabKey;
}

export const Route = createFileRoute("/woreda/households/$householdId/")({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): TabSearch => {
    const t = raw.tab;
    return { tab: VALID_TABS.includes(t as TabKey) ? (t as TabKey) : "overview" };
  },
  component: HouseholdDetailPage,
});

const HOUSE_TYPE_LABEL: Record<string, string> = {
  private: "የግል / Private",
  kebele: "የቀበሌ / Kebele",
  rental: "የኪራይ / Rental",
  government: "የመንግስት / Government",
  rented_by_private: "ኪራይ በግለሰብ / Rented by Private",
  other: "ሌላ / Other",
};

function HouseholdDetailPage() {
  const { householdId } = Route.useParams();
  const { tab } = useSearch({ from: "/woreda/households/$householdId/" });
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const queryClient = useQueryClient();

  const setTab = (next: TabKey) => {
    navigate({
      to: "/woreda/households/$householdId",
      params: { householdId },
      search: { tab: next },
    });
  };

  const printRef = useRef<HTMLDivElement>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [setHeadFor, setSetHeadFor] = useState<{ id: string; name: string } | null>(null);
  const [pendingCapture, setPendingCapture] = useState<"print" | "export" | null>(null);

  const householdQuery = useQuery({
    queryKey: ["household", householdId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("household")
        .select(
          `*,
          kebele:kebele_id ( kebele_number, kebele_name_am, kebele_name_en ),
          head:resident!household_head_resident_id ( resident_id, full_name_am ),
          spouse:resident!spouse_resident_id ( resident_id, full_name_am ),
          alt_head:resident!alternate_head_resident_id ( resident_id, full_name_am )`,
        )
        .eq("household_id", householdId)
        .eq("woreda_id", woredaId as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const membersQuery = useQuery({
    queryKey: ["household-members", householdId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select("resident_id, full_name_am, full_name, relation_to_head, residency_status")
        .eq("current_household_id", householdId)
        .eq("woreda_id", woredaId as string)
        .order("full_name_am");
      if (error) throw error;
      return data;
    },
  });

  const setHeadMutation = useMutation({
    mutationFn: async (newHeadId: string) => {
      if (!woredaId) throw new Error("Session error");
      const prev = householdQuery.data?.household_head_resident_id as string | null;
      const { error } = await supabase
        .from("household")
        .update({ household_head_resident_id: newHeadId })
        .eq("household_id", householdId)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "household",
        entity_id: householdId,
        action_type: "HEAD_CHANGED",
        old_value_json: { previous_head_id: prev } as never,
        new_value_json: { new_head_id: newHeadId } as never,
        action_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      toast.success("የቤተሰብ ኃላፊ ተቀይሯል / Household head updated");
      queryClient.invalidateQueries({ queryKey: ["household", householdId] });
      queryClient.invalidateQueries({ queryKey: ["household-members", householdId] });
      setSetHeadFor(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `household-${householdQuery.data?.house_number ?? "detail"}`,
  });

  const handleExportPdf = useCallback(async () => {
    if (!printRef.current) return;
    setExportingPdf(true);
    try {
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 40;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let position = 20;
      let heightLeft = imgHeight;
      pdf.addImage(imgData, "PNG", 20, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - 40;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight + 20;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 20, position, imgWidth, imgHeight);
        heightLeft -= pageHeight - 40;
      }
      pdf.save(`household-${householdQuery.data?.house_number ?? "detail"}.pdf`);
    } catch (e) {
      toast.error(`PDF ማውጣት አልተሳካም / PDF export failed: ${(e as Error).message}`);
    } finally {
      setExportingPdf(false);
    }
  }, [householdQuery.data?.house_number]);

  // Print/Export only ever capture the Overview tab's card grid (printRef
  // points into it). Radix's TabsContent unmounts inactive tabs entirely, so
  // printRef.current is null while on the Documents tab -- clicking either
  // button first switches back to Overview, then fires the actual
  // print/export once that content has remounted.
  useEffect(() => {
    if (!pendingCapture || tab !== "overview") return;
    const raf = requestAnimationFrame(() => {
      if (pendingCapture === "print") handlePrint?.();
      else void handleExportPdf();
      setPendingCapture(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingCapture, tab, handlePrint, handleExportPdf]);

  const triggerPrint = () => {
    if (tab !== "overview") {
      setPendingCapture("print");
      setTab("overview");
    } else {
      handlePrint?.();
    }
  };

  const triggerExportPdf = () => {
    if (tab !== "overview") {
      setPendingCapture("export");
      setTab("overview");
    } else {
      void handleExportPdf();
    }
  };

  if (!hasPermission(P.HOUSEHOLD_READ)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
        <p className="text-sm">You don't have permission to view this page.</p>
      </div>
    );
  }

  if (householdQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (householdQuery.error || !householdQuery.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-noto-ethiopic font-medium">ቤተሰብ አልተገኘም / Household not found</p>
        <Button variant="link" onClick={() => navigate({ to: "/woreda/households" })}>
          ← Back to list
        </Button>
      </div>
    );
  }

  const h = householdQuery.data;
  const kebele = h.kebele as unknown as {
    kebele_number: string;
    kebele_name_am: string;
    kebele_name_en: string | null;
  } | null;
  const head = h.head as unknown as { resident_id: string; full_name_am: string | null } | null;
  const spouse = h.spouse as unknown as { resident_id: string; full_name_am: string | null } | null;
  const alt = h.alt_head as unknown as { resident_id: string; full_name_am: string | null } | null;

  const kebeleLabel = kebele ? `ቀበሌ ${kebele.kebele_number}` : "—";
  const titleAm = `ቤት ቁጥር ${h.house_number} — ${kebeleLabel}`;
  const gpsLat = h.gps_lat as number | null;
  const gpsLng = h.gps_lng as number | null;
  const currentHeadId = (h.household_head_resident_id as string | null) ?? null;
  const canUpdate = hasPermission(P.HOUSEHOLD_UPDATE);

  const members = membersQuery.data ?? [];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Home}
        titleAm={titleAm}
        titleEn={`House ${h.house_number}${kebele?.kebele_name_en ? ` — Kebele ${kebele.kebele_number} ${kebele.kebele_name_en}` : ""}`}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <StatusChip status={h.occupancy_status as string} />
            <Button
              type="button"
              onClick={triggerPrint}
              className="rounded-md bg-blue-700 text-white hover:bg-blue-800"
              size="sm"
            >
              <Printer className="mr-2 h-4 w-4" />
              <span className="font-noto-ethiopic">አትም</span>
              <span className="ml-1 opacity-80">/ Print</span>
            </Button>
            <Button
              type="button"
              onClick={triggerExportPdf}
              disabled={exportingPdf}
              className="rounded-md bg-blue-700 text-white hover:bg-blue-800"
              size="sm"
            >
              {exportingPdf ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-2 h-4 w-4" />
              )}
              <span className="font-noto-ethiopic">PDF አውርድ</span>
              <span className="ml-1 opacity-80">/ Export PDF</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    navigate({
                      to: "/woreda/households/$householdId/edit",
                      params: { householdId },
                    })
                  }
                >
                  <Edit className="mr-2 h-4 w-4" />
                  <span className="font-noto-ethiopic">አስተካክል</span>
                  <span className="ml-1 text-xs opacity-70">/ Edit</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
        <TabsList>
          <TabsTrigger value="overview" className="flex-none">
            <span className="font-noto-ethiopic">አጠቃላይ</span>
            <span className="ml-1.5 text-xs text-slate-500">/ Overview</span>
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex-none">
            <span className="font-noto-ethiopic">ሰነዶች</span>
            <span className="ml-1.5 text-xs text-slate-500">/ Documents</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div ref={printRef} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* CARD 1 — Basic Information */}
            <Card className="overflow-hidden p-0">
              <CardHeader icon={Home} titleAm="መሰረታዊ መረጃ" titleEn="Basic Information" />
              <div className="p-5">
                <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                  <Row
                    label="Kebele"
                    value={
                      kebele ? `${kebele.kebele_number} — ${kebele.kebele_name_am}` : notRecorded()
                    }
                  />
                  <Row label="House #" value={h.house_number as string} mono />
                  <Row label="Address" value={(h.address_line as string) || notRecorded()} />
                  <Row
                    label="Occupancy"
                    value={<StatusChip status={h.occupancy_status as string} />}
                  />
                  <Row
                    label="House Type"
                    value={
                      h.house_type
                        ? (HOUSE_TYPE_LABEL[h.house_type as string] ?? (h.house_type as string))
                        : notRecorded()
                    }
                  />
                  {h.house_type === "other" && (
                    <Row
                      label="Other (specify)"
                      value={(h.house_type_other as string) || notRecorded()}
                    />
                  )}
                  {(h.house_type === "rental" || h.house_type === "rented_by_private") && (
                    <Row
                      label="Rent (ETB)"
                      value={h.rent_amount != null ? String(h.rent_amount) : notRecorded()}
                      mono
                    />
                  )}
                </dl>
              </div>
            </Card>

            {/* CARD 2 — Head & Family */}
            <Card className="overflow-hidden p-0">
              <CardHeader icon={Users} titleAm="የቤተሰብ ኃላፊ" titleEn="Household Head & Family" />
              <div className="space-y-2 p-5 text-sm">
                <PersonLink labelAm="የቤተሰብ ተጠሪ" labelEn="Head" person={head} />
                <PersonLink labelAm="የባል/የሚስት" labelEn="Spouse" person={spouse} />
                <PersonLink labelAm="ሌላ ተጠሪ" labelEn="Alternate Head" person={alt} />
              </div>
            </Card>

            {/* CARD 3 — Contact */}
            <Card className="overflow-hidden p-0 lg:col-span-2">
              <CardHeader icon={Phone} titleAm="እውቂያ" titleEn="Contact" />
              <div className="p-5">
                <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                  <Row label="Phone" value={(h.phone_number as string) || notRecorded()} mono />
                  <Row label="PO Box" value={(h.po_box as string) || notRecorded()} />
                  <Row label="Email" value={(h.email as string) || notRecorded()} />
                </dl>
              </div>
            </Card>

            {/* CARD 4 — Members */}
            <Card className="overflow-hidden p-0 lg:col-span-2">
              <CardHeader
                icon={Users}
                titleAm="የቤተሰብ አባላት"
                titleEn="Household Members"
                rightSlot={
                  <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold text-white">
                    {members.length}
                  </span>
                }
              />
              <div className="p-5">
                {membersQuery.isLoading && <Skeleton className="h-16 w-full" />}

                {!membersQuery.isLoading && members.length === 0 && (
                  <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center">
                    <p className="font-noto-ethiopic text-sm text-slate-700">
                      በዚህ ቤት ውስጥ የተመዘገበ ነዋሪ የለም
                    </p>
                    <p className="text-xs text-slate-500">
                      No residents registered in this household yet
                    </p>
                  </div>
                )}

                {members.length > 0 && (
                  <ul className="divide-y divide-slate-100">
                    {members.map((m) => {
                      const name = m.full_name_am || m.full_name || "—";
                      const initials = getInitials(name);
                      const isHead = m.resident_id === currentHeadId;
                      return (
                        <li key={m.resident_id} className="flex items-center gap-3 px-2 py-2.5">
                          <Link
                            to="/woreda/residents/$residentId"
                            params={{ residentId: m.resident_id }}
                            className="flex flex-1 items-center gap-3 rounded-md hover:bg-blue-50/40"
                          >
                            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-blue-100 font-noto-ethiopic text-sm font-semibold text-blue-700">
                              {initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-noto-ethiopic flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
                                <span className="truncate">{name}</span>
                                {isHead && (
                                  <Crown
                                    className="h-4 w-4 shrink-0 text-amber-500"
                                    aria-label="Household head"
                                  />
                                )}
                              </div>
                              <div className="font-noto-ethiopic truncate text-xs text-slate-500">
                                {(m.relation_to_head as string) || "—"}
                              </div>
                            </div>
                            <StatusChip status={(m.residency_status as string) ?? "—"} />
                          </Link>
                          {canUpdate && !isHead && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 print:hidden"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => setSetHeadFor({ id: m.resident_id, name })}
                                >
                                  <Crown className="mr-2 h-4 w-4 text-amber-500" />
                                  <span className="font-noto-ethiopic">የቤተሰብ ኃላፊ አድርግ</span>
                                  <span className="ml-1 text-xs opacity-70">/ Set as Head</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>

            {/* CARD 5 — Location (conditional) */}
            {gpsLat != null && gpsLng != null && (
              <Card className="overflow-hidden p-0 lg:col-span-2">
                <CardHeader icon={MapPin} titleAm="መገኛ አካባቢ" titleEn="Location" />
                <div className="p-5">
                  <Suspense fallback={<Skeleton className="h-[220px] w-full" />}>
                    <LocationDisplayMap
                      latitude={gpsLat}
                      longitude={gpsLng}
                      label={h.house_number as string}
                    />
                  </Suspense>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <HouseholdDocumentsTab householdId={householdId} woredaId={woredaId} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!setHeadFor} onOpenChange={(o) => !o && setSetHeadFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-noto-ethiopic">
              ይህን ግለሰብ የቤተሰብ ኃላፊ ማድረግ ይፈልጋሉ? / Set this person as household head?
            </AlertDialogTitle>
          </AlertDialogHeader>
          {setHeadFor && (
            <p className="font-noto-ethiopic text-sm text-slate-700">{setHeadFor.name}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={setHeadMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (setHeadFor) setHeadMutation.mutate(setHeadFor.id);
              }}
              className="bg-blue-700 hover:bg-blue-800"
            >
              <span className="font-noto-ethiopic">አረጋግጥ / Confirm</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CardHeader({
  icon: Icon,
  titleAm,
  titleEn,
  rightSlot,
}: {
  icon: React.ComponentType<{ className?: string }>;
  titleAm: string;
  titleEn: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 bg-blue-700 px-5 py-3 text-white">
      <Icon className="h-4 w-4 text-white" />
      <h3 className="font-noto-ethiopic text-base font-bold">
        {titleAm} <span className="font-medium text-blue-100">/ {titleEn}</span>
      </h3>
      {rightSlot && <div className="ml-auto">{rightSlot}</div>}
    </div>
  );
}

/** Ethiopian + Gregorian, matching ResidentProfileTabs.tsx's dateLabel(). */
function documentDateLabel(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatEthiopianDate(d)} · ${d.toLocaleDateString()}`;
}

function notRecorded() {
  return (
    <span className="font-noto-ethiopic text-slate-400">
      አልተመዘገበም <span className="text-slate-300">/ Not recorded</span>
    </span>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="col-span-1 text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`col-span-2 text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </>
  );
}

function PersonLink({
  labelAm,
  labelEn,
  person,
}: {
  labelAm: string;
  labelEn: string;
  person: { resident_id: string; full_name_am: string | null } | null;
}) {
  if (!person) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-slate-200 px-3 py-2">
        <span className="font-noto-ethiopic text-xs uppercase tracking-wide text-slate-500">
          {labelAm} <span className="text-slate-400">/ {labelEn}</span>
        </span>
        <span className="font-noto-ethiopic text-sm text-slate-400">አልተመዘገበም / Not set</span>
      </div>
    );
  }
  return (
    <Link
      to="/woreda/residents/$residentId"
      params={{ residentId: person.resident_id }}
      className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 hover:border-blue-300 hover:bg-blue-50/40"
    >
      <span className="font-noto-ethiopic text-xs uppercase tracking-wide text-slate-500">
        {labelAm} <span className="text-slate-400">/ {labelEn}</span>
      </span>
      <span className="font-noto-ethiopic text-sm font-medium text-slate-900">
        {person.full_name_am || "—"}
      </span>
    </Link>
  );
}

interface HouseholdDocumentRow {
  document_id: string;
  document_label: string;
  file_name: string;
  storage_path: string;
  created_at: string;
  resident: { resident_id: string; full_name_am: string | null; full_name: string | null } | null;
}

/**
 * Read-only, grouped by member. Uploading only ever happens from the owning
 * resident's own Documents tab -- there is no upload/delete control here.
 *
 * The joined resident is a live lookup (for display -- the uploader's
 * current name), not a re-derivation of household membership: household_id
 * on each row is a snapshot taken at upload time, so a listed resident may
 * have since moved to a different household. That's expected, not a bug --
 * this list intentionally shows the household's document history, not its
 * current membership.
 */
function HouseholdDocumentsTab({
  householdId,
  woredaId,
}: {
  householdId: string;
  woredaId: string | null;
}) {
  const q = useQuery({
    queryKey: ["household-tab-documents", householdId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_document")
        .select(
          "document_id, document_label, file_name, storage_path, created_at, resident:resident_id(resident_id, full_name_am, full_name)",
        )
        .eq("household_id", householdId)
        .eq("woreda_id", woredaId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("");
  const [viewerOpen, setViewerOpen] = useState(false);

  const openDocument = async (doc: HouseholdDocumentRow) => {
    setOpeningId(doc.document_id);
    try {
      const { data, error } = await supabase.storage
        .from("resident-documents")
        .createSignedUrl(doc.storage_path, 300);
      if (error || !data?.signedUrl) {
        toast.error("ፋይሉን መክፈት አልተቻለም / Could not open the file");
        return;
      }
      setViewerUrl(data.signedUrl);
      setViewerTitle(doc.document_label);
      setViewerOpen(true);
    } finally {
      setOpeningId(null);
    }
  };

  if (q.isLoading) return <Skeleton className="h-56 w-full" />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;

  const docs = q.data ?? [];
  const byResident = new Map<string, { name: string; docs: HouseholdDocumentRow[] }>();
  for (const doc of docs) {
    const rid = doc.resident?.resident_id ?? "unknown";
    const name = doc.resident?.full_name_am || doc.resident?.full_name || "—";
    if (!byResident.has(rid)) byResident.set(rid, { name, docs: [] });
    byResident.get(rid)!.docs.push(doc);
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 bg-blue-700 px-5 py-3 text-white">
        <FileText className="h-4 w-4 text-white" />
        <h3 className="font-noto-ethiopic text-base font-bold">
          ሰነዶች <span className="font-medium text-blue-100">/ Documents</span>
        </h3>
        <span className="ml-auto inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold text-white">
          {docs.length}
        </span>
      </div>
      <div className="p-5">
        {docs.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center">
            <p className="font-noto-ethiopic text-sm text-slate-700">ለዚህ ቤተሰብ የተጫነ ሰነድ የለም</p>
            <p className="text-xs text-slate-500">No documents uploaded for this household yet</p>
          </div>
        ) : (
          <div className="space-y-5">
            {Array.from(byResident.entries()).map(([rid, group]) => (
              <div key={rid}>
                <div className="font-noto-ethiopic mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {rid !== "unknown" ? (
                    <Link
                      to="/woreda/residents/$residentId"
                      params={{ residentId: rid }}
                      className="hover:underline"
                    >
                      {group.name}
                    </Link>
                  ) : (
                    group.name
                  )}
                </div>
                <ul className="divide-y divide-slate-100">
                  {group.docs.map((doc) => (
                    <li key={doc.document_id} className="flex items-center gap-3 px-2 py-2.5">
                      <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue-50 text-blue-700">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-noto-ethiopic truncate text-sm font-medium text-slate-900">
                          {doc.document_label}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {doc.file_name} · {documentDateLabel(doc.created_at)}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={openingId === doc.document_id}
                        onClick={() => openDocument(doc)}
                      >
                        {openingId === doc.document_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <span className="font-noto-ethiopic">ይመልከቱ</span>
                            <span className="ml-1 opacity-70">/ View</span>
                          </>
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {viewerOpen && (
        <Suspense fallback={null}>
          <DocumentViewerDialog
            open={viewerOpen}
            onOpenChange={setViewerOpen}
            signedUrl={viewerUrl}
            title={viewerTitle}
          />
        </Suspense>
      )}
    </Card>
  );
}
