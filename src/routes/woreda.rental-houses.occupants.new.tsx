import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ClipboardCheck,
  FileText,
  IdCard,
  Image as ImageIcon,
  Loader2,
  Save,
  Search,
  UploadCloud,
  UserSearch,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EthiopianDateInput } from "@/components/common/EthiopianDateInput";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { Navigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/woreda/rental-houses/occupants/new")({
  ssr: false,
  component: OccupantRegistrationPage,
  validateSearch: (s: Record<string, unknown>): { houseId?: string } =>
    typeof s.houseId === "string" ? { houseId: s.houseId } : {},
});

interface ResidentMatch {
  resident_id: string;
  resident_number: string;
  full_name_am: string | null;
  full_name: string | null;
}

interface HouseOption {
  rental_house_id: string;
  house_number: string;
  monthly_rent_standard: number | null;
  kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
}

type UploadKey = "contract" | "clearance" | "id_copy" | "photo";

const UPLOAD_TILES: {
  key: UploadKey;
  am: string;
  en: string;
  hint: string;
  accept: string;
  types: string[];
  maxMB: number;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    key: "contract",
    am: "የቤት ኪራይ ውል ሰነድ",
    en: "Rental Contract",
    hint: "PDF, JPG (Max 5MB)",
    accept: "application/pdf,image/jpeg,image/png",
    types: ["application/pdf", "image/jpeg", "image/png"],
    maxMB: 5,
    icon: FileText,
  },
  {
    key: "clearance",
    am: "የቀድሞ ክሊራንስ",
    en: "Previous Clearance",
    hint: "PDF, JPG (Max 5MB)",
    accept: "application/pdf,image/jpeg,image/png",
    types: ["application/pdf", "image/jpeg", "image/png"],
    maxMB: 5,
    icon: ClipboardCheck,
  },
  {
    key: "id_copy",
    am: "የመታወቂያ ኮፒ",
    en: "ID Copy",
    hint: "PDF, JPG (Max 5MB)",
    accept: "application/pdf,image/jpeg,image/png",
    types: ["application/pdf", "image/jpeg", "image/png"],
    maxMB: 5,
    icon: IdCard,
  },
  {
    key: "photo",
    am: "ጠንካራ ፎቶግራፍ",
    en: "Photo",
    hint: "JPG, PNG (Max 2MB)",
    accept: "image/jpeg,image/png",
    types: ["image/jpeg", "image/png"],
    maxMB: 2,
    icon: ImageIcon,
  },
];

const RENTAL_DOCS_BUCKET = "rental-request-documents";

function sanitizeFileName(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = dot > -1 ? name.slice(dot + 1).toLowerCase() : "bin";
  return `${Date.now()}.${ext.replace(/[^a-z0-9]/g, "")}`;
}

function OccupantRegistrationPage() {
  const navigate = useNavigate();
  const { houseId: houseIdFromSearch } = Route.useSearch();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  // --- Occupant identity
  const [residentSearch, setResidentSearch] = useState("");
  const [resident, setResident] = useState<ResidentMatch | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // --- Contract
  const [houseId, setHouseId] = useState<string>(houseIdFromSearch ?? "");

  // Eligibility comes from the DATABASE, via the same rental_eligibility()
  // function the BEFORE INSERT trigger calls (migration 31). Deliberately not
  // reimplemented here: a client rule that drifts from its server half is the
  // failure this codebase keeps hitting, and the whole point of the shared
  // function is that the screen and the gate cannot disagree.
  //
  // The rule is the name on the occupancy, not the household -- a member of a
  // household that holds a kebele house is still eligible. house_type comes
  // back for the officer to weigh, never to block on.
  const eligibility = useQuery({
    queryKey: ["rental-eligibility", resident?.resident_id, houseId],
    enabled: !!resident?.resident_id && !!houseId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "rental_eligibility" as never,
        {
          _resident_id: resident!.resident_id,
          _rental_house_id: houseId,
          _request_type: "new_registration",
        } as never,
      );
      if (error) throw error;
      return data as unknown as {
        eligible: boolean;
        house_type: string | null;
        is_household_head: boolean;
        reasons: { code: string; am: string; en: string }[];
      };
    },
  });
  const ineligible = eligibility.data && !eligibility.data.eligible;
  const [rentAmount, setRentAmount] = useState<string>("");
  const [rentStart, setRentStart] = useState<string>("");

  // --- Uploads (files are stored on submit and linked to the request)
  const [uploads, setUploads] = useState<Partial<Record<UploadKey, File>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploadStep, setUploadStep] = useState<string | null>(null);

  function setUpload(key: UploadKey, file: File | null) {
    const tile = UPLOAD_TILES.find((t) => t.key === key)!;
    if (!file) {
      setUploads((u) => {
        const next = { ...u };
        delete next[key];
        return next;
      });
      return;
    }
    if (!tile.types.includes(file.type)) {
      toast.error(`${tile.en}: unsupported file type — allowed ${tile.hint}`);
      return;
    }
    if (file.size > tile.maxMB * 1024 * 1024) {
      toast.error(`${tile.en}: file is larger than ${tile.maxMB}MB`);
      return;
    }
    setUploads((u) => ({ ...u, [key]: file }));
  }

  // Fetch houses for the selector, prefer vacant
  const { data: houses } = useQuery({
    queryKey: ["rental-house-options", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele_rental_house")
        .select(
          "rental_house_id, house_number, monthly_rent_standard, occupancy_status, kebele:kebele_id ( kebele_name_am, kebele_number )",
        )
        .eq("woreda_id", woredaId!)
        .order("house_number");
      if (error) throw error;
      return data as unknown as (HouseOption & { occupancy_status: string })[];
    },
  });

  const selectedHouse = useMemo(
    () => houses?.find((h) => h.rental_house_id === houseId) ?? null,
    [houses, houseId],
  );

  // Resident search — sanitized term, min 2 usable characters
  const term = useMemo(
    () =>
      residentSearch
        .replace(/[%,()*]/g, "")
        .trim()
        .slice(0, 60),
    [residentSearch],
  );
  const termTooShort = term.length > 0 && term.length < 2;
  const searchEnabled = searchOpen && !!woredaId && term.length >= 2;

  const search = useQuery({
    queryKey: ["occupant-resident-search", woredaId, term],
    enabled: searchEnabled,
    retry: false,
    queryFn: async () => {
      // resident_decrypted isn't in the generated types yet (00000000000023_
      // pii_encryption.sql) -- same untyped-client cast pattern already used
      // elsewhere in this codebase for pre-typegen tables.
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data, error } = await db
        .from("resident_decrypted")
        .select("resident_id, resident_number, full_name_am, full_name")
        .eq("woreda_id", woredaId!)
        .eq("active_flag", true)
        .or(
          [
            `full_name_am.ilike.%${term}%`,
            `full_name.ilike.%${term}%`,
            `resident_number.ilike.%${term}%`,
          ].join(","),
        )
        .limit(10);
      if (error) throw error;
      return data as ResidentMatch[];
    },
  });

  function pickResident(r: ResidentMatch) {
    setResident(r);
    setSearchOpen(false);
    setResidentSearch("");
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!woredaId) throw new Error("Missing woreda context");
      if (!resident) throw new Error("ተከራይ ይምረጡ / Select the occupant");
      if (!houseId) throw new Error("የቤት ቁጥር ይምረጡ / Select the rental house");
      const amt = Number(rentAmount);
      if (!amt || amt <= 0) throw new Error("ትክክለኛ የቤት ኪራይ ዋጋ ያስገቡ / Enter valid rent amount");
      if (!rentStart) throw new Error("የውል መጀመሪያ ቀን ያስፈልጋል / Contract start required");

      const { data, error } = await supabase
        .from("rental_occupancy_request")
        .insert({
          woreda_id: woredaId,
          rental_house_id: houseId,
          resident_id: resident.resident_id,
          request_type: "new_registration",
          request_number: "",
          rent_start_date: rentStart,
          rent_amount: amt,
          status: "submitted",
          requested_by_user_id: actorUserId,
        } as never)
        .select("rental_request_id, request_number")
        .single();
      if (error) throw error;
      const rid = (data as { rental_request_id: string }).rental_request_id;

      // Upload attachments and link them to the request
      const entries = Object.entries(uploads).filter(([, f]) => !!f) as [UploadKey, File][];
      const uploadNames: Record<string, string | null> = {};
      const failed: string[] = [];

      for (const [key, file] of entries) {
        const tile = UPLOAD_TILES.find((t) => t.key === key)!;
        setUploadStep(tile.en);
        const path = `${woredaId}/${rid}/${key}-${sanitizeFileName(file.name)}`;
        const { error: upErr } = await supabase.storage
          .from(RENTAL_DOCS_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) {
          failed.push(tile.en);
          continue;
        }
        const { error: docErr } = await supabase.from("rental_request_document").insert({
          woreda_id: woredaId,
          rental_request_id: rid,
          document_type: key,
          file_name: file.name,
          storage_path: path,
          file_size_bytes: file.size,
          content_type: file.type,
          uploaded_by_user_id: actorUserId,
        });
        if (docErr) failed.push(tile.en);
        else uploadNames[key] = file.name;
      }
      setUploadStep(null);

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "rental_occupancy_request",
        entity_id: rid,
        action_type: "RENTAL_REQUEST_CREATED",
        new_value_json: {
          request_type: "new_registration",
          resident_id: resident.resident_id,
          rental_house_id: houseId,
          rent_start_date: rentStart,
          rent_amount: amt,
          uploads: uploadNames,
        } as never,
      });

      return { rid, failed };
    },
    onSuccess: ({ rid, failed }) => {
      setConfirmOpen(false);
      if (failed.length > 0) {
        toast.warning(
          `ተመዝግቧል / Registered, but these documents failed to upload: ${failed.join(", ")}`,
        );
      } else {
        toast.success("ተከራይ በተሳካ ሁኔታ ተመዝግቧል / Occupant registered successfully");
      }
      navigate({
        to: "/woreda/rental-houses/requests/$requestId",
        params: { requestId: rid },
      });
    },
    onError: (e: Error) => {
      setUploadStep(null);
      toast.error(`ምዝገባ አልተሳካም / Registration failed — ${e.message}`);
    },
  });

  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (!resident) errs.push("ተከራይ ይምረጡ / Select the occupant");
    if (!houseId) errs.push("የቤት ቁጥር ይምረጡ / Select the rental house");
    if (!Number(rentAmount) || Number(rentAmount) <= 0)
      errs.push("ትክክለኛ የቤት ኪራይ ዋጋ ያስገቡ / Enter a valid rent amount");
    if (!rentStart) errs.push("የውል መጀመሪያ ቀን ያስፈልጋል / Contract start date required");
    return errs;
  }, [resident, houseId, rentAmount, rentStart]);

  function openConfirm() {
    if (validationErrors.length > 0) {
      toast.error(validationErrors[0]!);
      return;
    }
    setConfirmOpen(true);
  }

  if (!hasPermission(P.RENTAL_CREATE)) return <Navigate to="/woreda/rental-houses" />;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center text-sm text-slate-500">
        <Link
          to="/woreda/rental-houses"
          className="inline-flex items-center gap-1 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Kebele Rental Houses
        </Link>
        <span className="mx-2 text-slate-300">/</span>
        <span className="text-slate-700">Occupant Registration Form</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-am-heading text-2xl font-bold tracking-tight text-[#0b2a63] md:text-3xl">
            የቀበሌ ቤት ተከራዮች ምዝገባ ቅጽ
          </h1>
          <p className="font-am-body mt-1 text-sm text-slate-500">ሁሉንም መረጃዎች በጥንቃቄ መሙላትዎን ያረጋግጡ።</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/woreda/rental-houses" })}
            className="font-am-body"
          >
            ሰርዝ
          </Button>
          <Button
            type="button"
            onClick={openConfirm}
            // Blocked client-side purely so the officer is not sent into a form
            // the database will refuse. The trigger is the real gate.
            disabled={mutation.isPending || !!ineligible || eligibility.isLoading}
            className="bg-[#0b2a63] font-am-body text-white hover:bg-[#0b2a63]/90"
          >
            {mutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            {mutation.isPending
              ? uploadStep
                ? `ሰነድ እየተላከ… (${uploadStep})`
                : "እየተመዘገበ..."
              : "ይመዝገቡ"}
          </Button>
        </div>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !mutation.isPending && setConfirmOpen(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-am-body">
              ምዝገባውን ያረጋግጡ / Confirm registration
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="font-am-body">የተከራይ ምዝገባ ጥያቄ ይፈጠራል። መረጃውን ያረጋግጡ።</p>
                <ul className="space-y-1 text-slate-600">
                  <li>
                    <span className="font-medium">Occupant:</span>{" "}
                    <span className="font-am-body">
                      {resident?.full_name_am || resident?.full_name || "—"}
                    </span>{" "}
                    ({resident?.resident_number})
                  </li>
                  <li>
                    <span className="font-medium">House:</span> {selectedHouse?.house_number ?? "—"}
                  </li>
                  <li>
                    <span className="font-medium">Rent:</span>{" "}
                    {Number(rentAmount || 0).toLocaleString()} ETB
                  </li>
                  <li>
                    <span className="font-medium">Start:</span> {rentStart || "—"}
                  </li>
                  <li>
                    <span className="font-medium">Documents:</span> {Object.keys(uploads).length}{" "}
                    attached
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending} className="font-am-body">
              ተመለስ
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
              className="bg-[#0b2a63] font-am-body hover:bg-[#0b2a63]/90"
            >
              {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              አረጋግጥ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Top row: Identity | Contract */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Occupant ID */}
        <Card className="border-slate-200 p-5">
          <SectionTitle icon={UserSearch} am="የተከራይ መታወቂያ መረጃ" />
          <div className="mt-4 space-y-4">
            {resident && houseId && (eligibility.isLoading || eligibility.data) && (
              <div
                className={
                  eligibility.isLoading
                    ? "rounded-md border border-slate-200 bg-slate-50 p-3"
                    : ineligible
                      ? "rounded-md border-2 border-red-300 bg-red-50 p-3"
                      : "rounded-md border border-emerald-300 bg-emerald-50 p-3"
                }
              >
                {eligibility.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-am-body">ብቁነት በመመርመር ላይ</span>
                    <span className="text-xs">/ Checking eligibility</span>
                  </div>
                ) : ineligible ? (
                  <div className="space-y-2">
                    <div className="font-am-body text-sm font-semibold text-red-800">
                      ይህ ነዋሪ ብቁ አይደለም
                      <span className="ml-2 font-sans text-xs font-normal text-red-700">
                        / This resident is not eligible
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {eligibility.data!.reasons.map((r) => (
                        <li key={r.code} className="text-sm text-red-800">
                          <span className="font-am-body">{r.am}</span>
                          <span className="mt-0.5 block text-xs text-red-700">/ {r.en}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="font-am-body text-sm font-semibold text-emerald-800">
                      ብቁ ነው
                      <span className="ml-2 font-sans text-xs font-normal text-emerald-700">
                        / Eligible
                      </span>
                    </div>
                    {/* house_type is context for the verifier, not a blocker --
                        a household member is not the holder. */}
                    {eligibility.data!.house_type && (
                      <div className="text-xs text-emerald-800">
                        <span className="font-am-body">የአሁኑ የቤት ዓይነት፦ </span>
                        <span>{eligibility.data!.house_type}</span>
                        {eligibility.data!.is_household_head ? (
                          <span className="font-am-body"> (የቤተሰብ ኃላፊ / household head)</span>
                        ) : (
                          <span className="font-am-body"> (የቤተሰብ አባል / household member)</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <FieldLabel am="የነዋሪነት መለያ ቁጥር" en="Resident ID" />
              <div className="relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      readOnly
                      value={resident?.resident_number ?? ""}
                      placeholder="—"
                      className="pr-9"
                    />
                    {resident && (
                      <button
                        type="button"
                        onClick={() => setResident(null)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-red-600"
                        aria-label="Clear"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={() => setSearchOpen((o) => !o)}
                    className="bg-blue-100 font-am-body text-blue-700 hover:bg-blue-200"
                  >
                    <Search className="mr-1 h-4 w-4" /> ፈልግ
                  </Button>
                </div>
                {searchOpen && (
                  <div className="absolute z-30 mt-2 w-full rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                    <Input
                      autoFocus
                      value={residentSearch}
                      maxLength={60}
                      onChange={(e) => setResidentSearch(e.target.value)}
                      placeholder="Search by name / resident #"
                      className="mb-2"
                    />
                    <div className="max-h-56 overflow-auto">
                      {term.length === 0 && (
                        <div className="p-2 text-sm text-slate-500 font-am-body">
                          ስም ወይም መለያ ቁጥር ይጻፉ / Type a name or resident number
                        </div>
                      )}
                      {termTooShort && (
                        <div className="p-2 text-sm text-amber-600 font-am-body">
                          ቢያንስ 2 ፊደል ያስገቡ / Enter at least 2 characters
                        </div>
                      )}
                      {searchEnabled && search.isFetching && (
                        <div className="flex items-center gap-2 p-2 text-sm text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                        </div>
                      )}
                      {searchEnabled && search.isError && (
                        <div className="p-2 text-sm text-red-600">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" /> Search failed.
                          </div>
                          <button
                            type="button"
                            onClick={() => search.refetch()}
                            className="mt-1 text-xs font-medium underline"
                          >
                            Retry
                          </button>
                        </div>
                      )}
                      {searchEnabled &&
                        !search.isFetching &&
                        !search.isError &&
                        (search.data?.length ?? 0) === 0 && (
                          <div className="p-2 text-sm text-slate-500 font-am-body">
                            ምንም ውጤት የለም / No residents matched “{term}”
                          </div>
                        )}
                      {search.data?.map((r) => (
                        <button
                          key={r.resident_id}
                          type="button"
                          onClick={() => pickResident(r)}
                          className="block w-full rounded px-2 py-1.5 text-left hover:bg-blue-50"
                        >
                          <div className="font-am-body text-sm font-medium text-slate-900">
                            {r.full_name_am || r.full_name || "—"}
                          </div>
                          <div className="font-mono text-xs text-slate-500">
                            {r.resident_number}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <FieldLabel am="ሙሉ ስም (የአባትና አያት ስምን ጨምሮ)" en="Full Name" />
              <Input
                readOnly
                value={resident?.full_name_am || resident?.full_name || ""}
                placeholder="—"
                className="font-am-body"
              />
            </div>
          </div>
        </Card>

        {/* Contract details */}
        <Card className="border-slate-200 p-5">
          <SectionTitle icon={FileText} am="የውል ዝርዝር መረጃ" />
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel am="የቤት ቁጥር" en="House #" />
                <select
                  value={houseId}
                  onChange={(e) => {
                    setHouseId(e.target.value);
                    const h = houses?.find((x) => x.rental_house_id === e.target.value);
                    if (h?.monthly_rent_standard != null && !rentAmount)
                      setRentAmount(String(h.monthly_rent_standard));
                  }}
                  className="font-am-body flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">ምረጥ</option>
                  {houses?.map((h) => (
                    <option key={h.rental_house_id} value={h.rental_house_id}>
                      {h.house_number}
                      {h.occupancy_status !== "vacant" ? ` (${h.occupancy_status})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel am="ቀበሌ" en="Kebele" />
                <Input
                  readOnly
                  value={
                    selectedHouse?.kebele?.kebele_name_am
                      ? `${selectedHouse.kebele.kebele_name_am}${
                          selectedHouse.kebele.kebele_number != null
                            ? ` #${selectedHouse.kebele.kebele_number}`
                            : ""
                        }`
                      : ""
                  }
                  placeholder="—"
                  className="font-am-body"
                />
              </div>
            </div>

            <div>
              <FieldLabel am="ወርሃዊ የኪራይ መጠን (ብር)" en="Monthly Rent (ETB)" />
              <Input
                type="number"
                min={0}
                value={rentAmount}
                onChange={(e) => setRentAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div>
              <FieldLabel am="የውል መጀመሪያ" en="Contract Start" />
              <EthiopianDateInput value={rentStart} onChange={setRentStart} />
            </div>
          </div>
        </Card>
      </div>

      {/* Uploads */}
      <Card className="border-slate-200 p-5">
        <SectionTitle icon={UploadCloud} am="አስፈላጊ ሰነዶች" en="Upload" />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {UPLOAD_TILES.map((tile) => (
            <UploadTile
              key={tile.key}
              tile={tile}
              file={uploads[tile.key] ?? null}
              disabled={mutation.isPending}
              onChange={(f) => setUpload(tile.key, f)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  am,
  en,
  iconClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  am: string;
  en?: string;
  iconClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("h-5 w-5 text-[#0b2a63]", iconClassName)} />
      <h2 className="font-am-heading text-base font-semibold text-slate-900">
        {am}
        {en && <span className="ml-1 text-sm font-normal text-slate-500">({en})</span>}
      </h2>
    </div>
  );
}

function FieldLabel({ am, en }: { am: string; en: string }) {
  return (
    <Label className="mb-1.5 block">
      <span className="font-am-body text-xs font-medium text-slate-600">{am}</span>{" "}
      <span className="text-xs text-slate-400">({en})</span>
    </Label>
  );
}

function UploadTile({
  tile,
  file,
  onChange,
  disabled,
}: {
  tile: (typeof UPLOAD_TILES)[number];
  file: File | null;
  onChange: (f: File | null) => void;
  disabled?: boolean;
}) {
  const inputId = `upload-${tile.key}`;
  const Icon = tile.icon;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition",
        file
          ? "border-emerald-400 bg-emerald-50/40"
          : "border-slate-200 bg-slate-50/60 hover:border-blue-300 hover:bg-blue-50/40",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <Icon className={cn("h-6 w-6", file ? "text-emerald-600" : "text-slate-400")} />
      <div className="font-am-body text-sm font-medium text-slate-800">{tile.am}</div>
      <div className="text-xs text-slate-400">{tile.hint}</div>
      {file && (
        <>
          <div className="mt-1 max-w-[160px] truncate text-xs text-emerald-700">{file.name}</div>
          <div className="text-[11px] text-emerald-600">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onChange(null);
            }}
            className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            aria-label={`Remove ${tile.en}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      <input
        id={inputId}
        type="file"
        accept={tile.accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </label>
  );
}
