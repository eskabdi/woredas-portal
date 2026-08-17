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
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserSearch,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  sex: string | null;
  phone_number: string | null;
}

interface HouseOption {
  rental_house_id: string;
  house_number: string;
  monthly_rent_standard: number | null;
  kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
}

interface MemberRow {
  id: string;
  full_name: string;
  relation: string;
  age: string;
  work_status: string;
}

type Frequency = "biweekly" | "quarterly" | "annual";

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
  const [sex, setSex] = useState<string>("");
  const [phone, setPhone] = useState<string>("+251");

  // --- Contract
  const [houseId, setHouseId] = useState<string>(houseIdFromSearch ?? "");
  const [rentAmount, setRentAmount] = useState<string>("");
  const [rentStart, setRentStart] = useState<string>("");
  const [rentEnd, setRentEnd] = useState<string>("");
  const [frequency, setFrequency] = useState<Frequency>("biweekly");

  // --- Household roster
  const [members, setMembers] = useState<MemberRow[]>([]);

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
      toast.error(
        `${tile.en}: unsupported file type — allowed ${tile.hint}`,
      );
      return;
    }
    if (file.size > tile.maxMB * 1024 * 1024) {
      toast.error(`${tile.en}: file is larger than ${tile.maxMB}MB`);
      return;
    }
    setUploads((u) => ({ ...u, [key]: file }));
  }

  // --- Admin
  const [verified, setVerified] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<"approved" | "pending">("pending");
  const [notes, setNotes] = useState("");

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
    () => residentSearch.replace(/[%,()*]/g, "").trim().slice(0, 60),
    [residentSearch],
  );
  const termTooShort = term.length > 0 && term.length < 2;
  const searchEnabled = searchOpen && !!woredaId && term.length >= 2;

  const search = useQuery({
    queryKey: ["occupant-resident-search", woredaId, term],
    enabled: searchEnabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select("resident_id, resident_number, full_name_am, full_name, sex, phone_number")
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
    setSex(r.sex ?? "");
    if (r.phone_number) setPhone(r.phone_number.startsWith("+") ? r.phone_number : `+251${r.phone_number.replace(/^0/, "")}`);
    setSearchOpen(false);
    setResidentSearch("");
  }

  function addMember() {
    setMembers((m) => [
      ...m,
      { id: crypto.randomUUID(), full_name: "", relation: "", age: "", work_status: "" },
    ]);
  }
  function updateMember(id: string, patch: Partial<MemberRow>) {
    setMembers((m) => m.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeMember(id: string) {
    setMembers((m) => m.filter((r) => r.id !== id));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!woredaId) throw new Error("Missing woreda context");
      if (!resident) throw new Error("ተከራይ ይምረጡ / Select the occupant");
      if (!houseId) throw new Error("የቤት ቁጥር ይምረጡ / Select the rental house");
      const amt = Number(rentAmount);
      if (!amt || amt <= 0) throw new Error("ልክ የቤት ኪራይ ያስገቡ / Enter valid rent amount");
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
          rent_end_date: rentEnd || null,
          rent_amount: amt,
          payment_frequency: frequency,
          phone,
          sex,
          household_members: members,
          uploads: uploadNames,
          admin: { verified, approval_status: approvalStatus, notes },
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
      errs.push("ልክ የቤት ኪራይ ያስገቡ / Enter a valid rent amount");
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
          <h1 className="font-noto-ethiopic text-2xl font-bold tracking-tight text-[#0b2a63] md:text-3xl">
            የቀበሌ ቤት ተከራዮች ምዝገባ ቅጽ
          </h1>
          <p className="font-noto-ethiopic mt-1 text-sm text-slate-500">
            ሁሉንም መረጃዎች በጥንቃቄ መሙላትዎን ያረጋግጡ።
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/woreda/rental-houses" })}
            className="font-noto-ethiopic"
          >
            ሰርዝ
          </Button>
          <Button
            type="button"
            onClick={openConfirm}
            disabled={mutation.isPending}
            className="bg-[#0b2a63] font-noto-ethiopic text-white hover:bg-[#0b2a63]/90"
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

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !mutation.isPending && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-noto-ethiopic">
              ምዝገባውን ያረጋግጡ / Confirm registration
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="font-noto-ethiopic">
                  የተከራይ ምዝገባ ጥያቄ ይፈጠራል። መረጃውን ያረጋግጡ።
                </p>
                <ul className="space-y-1 text-slate-600">
                  <li>
                    <span className="font-medium">Occupant:</span>{" "}
                    <span className="font-noto-ethiopic">
                      {resident?.full_name_am || resident?.full_name || "—"}
                    </span>{" "}
                    ({resident?.resident_number})
                  </li>
                  <li>
                    <span className="font-medium">House:</span>{" "}
                    {selectedHouse?.house_number ?? "—"}
                  </li>
                  <li>
                    <span className="font-medium">Rent:</span>{" "}
                    {Number(rentAmount || 0).toLocaleString()} ETB / {frequency}
                  </li>
                  <li>
                    <span className="font-medium">Start:</span> {rentStart || "—"}
                  </li>
                  <li>
                    <span className="font-medium">Documents:</span>{" "}
                    {Object.keys(uploads).length} attached
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending} className="font-noto-ethiopic">
              ተመለስ
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
              className="bg-[#0b2a63] font-noto-ethiopic hover:bg-[#0b2a63]/90"
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
                    className="bg-blue-100 font-noto-ethiopic text-blue-700 hover:bg-blue-200"
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
                        <div className="p-2 text-sm text-slate-500 font-noto-ethiopic">
                          ስም ወይም መለያ ቁጥር ይጻፉ / Type a name or resident number
                        </div>
                      )}
                      {termTooShort && (
                        <div className="p-2 text-sm text-amber-600 font-noto-ethiopic">
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
                          <div className="p-2 text-sm text-slate-500 font-noto-ethiopic">
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
                          <div className="font-noto-ethiopic text-sm font-medium text-slate-900">
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
                className="font-noto-ethiopic"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel am="ጾታ" en="Sex" />
                <select
                  value={sex}
                  onChange={(e) => setSex(e.target.value)}
                  className="font-noto-ethiopic flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">ምረጥ</option>
                  <option value="male">ወንድ / Male</option>
                  <option value="female">ሴት / Female</option>
                </select>
              </div>
              <div>
                <FieldLabel am="ስልክ ቁጥር" en="Phone" />
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+251"
                />
              </div>
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
                  className="font-noto-ethiopic flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
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
                  className="font-noto-ethiopic"
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel am="የውል መጀመሪያ" en="Contract Start" />
                <EthiopianDateInput value={rentStart} onChange={setRentStart} />
              </div>
              <div>
                <FieldLabel am="የውል ማብቂያ" en="Contract End" />
                <EthiopianDateInput value={rentEnd} onChange={setRentEnd} />
              </div>
            </div>

            <div>
              <FieldLabel am="የክፍያ ድግግሞሽ" en="Payment Frequency" />
              <div className="mt-1 flex flex-wrap gap-2">
                {(
                  [
                    { v: "biweekly", am: "በየሁሉ" },
                    { v: "quarterly", am: "በ3 ወር" },
                    { v: "annual", am: "በዓመት" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setFrequency(opt.v)}
                    className={cn(
                      "font-noto-ethiopic rounded-md border px-4 py-2 text-sm transition",
                      frequency === opt.v
                        ? "border-[#0b2a63] bg-[#0b2a63] text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                    )}
                  >
                    {opt.am}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Household roster */}
      <Card className="border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <SectionTitle icon={Users} am="አብረው የሚኖሩ የቤተሰብ አባላት" />
          <button
            type="button"
            onClick={addMember}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900"
          >
            <Plus className="h-4 w-4" /> <span className="font-noto-ethiopic">አባል ጨምር</span>
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="text-left">
                <th className="px-3 py-2 font-noto-ethiopic w-12">ተ.ቁ</th>
                <th className="px-3 py-2 font-noto-ethiopic">ሙሉ ስም</th>
                <th className="px-3 py-2 font-noto-ethiopic">ዝምድና</th>
                <th className="px-3 py-2 font-noto-ethiopic w-24">ዕድሜ</th>
                <th className="px-3 py-2 font-noto-ethiopic">የስራ ሁኔታ</th>
                <th className="px-3 py-2 font-noto-ethiopic w-16 text-right">ተግባር</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400 font-noto-ethiopic">
                    ምንም አባል አልተጨመረም — "አባል ጨምር" የሚለውን ይጫኑ
                  </td>
                </tr>
              )}
              {members.map((m, idx) => (
                <tr key={m.id} className="border-t align-top">
                  <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <Input
                      value={m.full_name}
                      onChange={(e) => updateMember(m.id, { full_name: e.target.value })}
                      className="font-noto-ethiopic h-9"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={m.relation}
                      onChange={(e) => updateMember(m.id, { relation: e.target.value })}
                      className="font-noto-ethiopic h-9"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      value={m.age}
                      onChange={(e) => updateMember(m.id, { age: e.target.value })}
                      className="h-9"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={m.work_status}
                      onChange={(e) => updateMember(m.id, { work_status: e.target.value })}
                      className="font-noto-ethiopic h-9"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeMember(m.id)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Uploads | Admin */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="border-slate-200 p-5">
          <SectionTitle icon={UploadCloud} am="አስፈላጊ ሰነዶች" en="Upload" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        <Card className="relative overflow-hidden border-slate-200 p-5">
          <div className="absolute inset-y-0 left-0 w-1.5 bg-orange-500" />
          <SectionTitle icon={ShieldCheck} am="አስተዳደራዊ ማረጋገጫ" iconClassName="text-orange-600" />
          <div className="mt-4 space-y-5">
            <label className="flex cursor-pointer items-start gap-3 rounded-md bg-slate-50 p-3">
              <Checkbox
                checked={verified}
                onCheckedChange={(v) => setVerified(v === true)}
                className="mt-0.5"
              />
              <div>
                <div className="font-noto-ethiopic text-sm font-medium text-slate-900">
                  ኦፊሴላዊ ማረጋገጫ{" "}
                  <span className="text-slate-500 font-normal">(Official Verification)</span>
                </div>
                <div className="font-noto-ethiopic mt-1 text-xs text-slate-500">
                  የቀበሌ ሰነዶች በሙሉ ኦርጅናል መሆናቸውን እና የተከራይ ማንነት መረጋገጡን አረጋግጣለሁ።
                </div>
              </div>
            </label>

            <div>
              <div className="font-noto-ethiopic text-sm text-slate-700">
                የምዝገባ ሁኔታ{" "}
                <span className="text-slate-500">(Approval Status)</span>
              </div>
              <div className="mt-2 space-y-2">
                {(
                  [
                    { v: "approved", am: "ተፈቅዷል", en: "Approved", color: "text-emerald-700" },
                    { v: "pending", am: "በጠረት ላይ", en: "Pending", color: "text-orange-600" },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.v}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition",
                      approvalStatus === opt.v
                        ? "border-slate-300 bg-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                  >
                    <input
                      type="radio"
                      name="approval"
                      checked={approvalStatus === opt.v}
                      onChange={() => setApprovalStatus(opt.v)}
                      className="h-4 w-4 accent-[#0b2a63]"
                    />
                    <span className={cn("font-noto-ethiopic text-sm font-medium", opt.color)}>
                      {opt.am}{" "}
                      <span className="text-slate-500 font-normal">({opt.en})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="font-noto-ethiopic text-sm text-slate-700">ማስታወሻ ካለ</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ተጨማሪ አስተያየት እዚህ ይጻፉ..."
                className="mt-1 font-noto-ethiopic"
                rows={4}
              />
            </div>
          </div>
        </Card>
      </div>
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
      <h2 className="font-noto-ethiopic text-base font-semibold text-slate-900">
        {am}
        {en && <span className="ml-1 text-sm font-normal text-slate-500">({en})</span>}
      </h2>
    </div>
  );
}

function FieldLabel({ am, en }: { am: string; en: string }) {
  return (
    <Label className="mb-1.5 block">
      <span className="font-noto-ethiopic text-xs font-medium text-slate-600">{am}</span>{" "}
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
      <Icon
        className={cn("h-6 w-6", file ? "text-emerald-600" : "text-slate-400")}
      />
      <div className="font-noto-ethiopic text-sm font-medium text-slate-800">{tile.am}</div>
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
