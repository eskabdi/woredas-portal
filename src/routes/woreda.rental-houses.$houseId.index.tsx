import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Building2, Pencil, UserPlus, UserMinus, ScrollText, Printer } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EthiopianDateInput } from "@/components/common/EthiopianDateInput";
import { ResidentSearchPicker } from "@/components/forms/ResidentSearchPicker";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { OCCUPATION_OPTIONS } from "@/lib/residentConstants";
import { Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/woreda/rental-houses/$houseId/")({
  ssr: false,
  component: RentalHouseDetailPage,
});

function fmtDate(d: string | null | undefined) {
  return d ? d : "—";
}

interface ResidentBirthPlace {
  place_name?: string;
  kebele?: string;
  woreda?: string;
}

interface ResidentWorkInfo {
  occupation_post?: string;
  occupation_status?: string;
  work_address?: string;
}

function birthPlaceLabel(bp: ResidentBirthPlace | null): string {
  if (!bp) return "";
  if (bp.place_name?.trim()) return bp.place_name;
  return [bp.kebele, bp.woreda].filter((x): x is string => !!x?.trim()).join(", ");
}

/** Mirrors formatOccupation() in woreda.residents.$residentId.index.tsx --
 * occupation_post (a specific job title) is the exception, not the norm;
 * most residents only have occupation_status (a category like "Employed")
 * recorded, and reading only occupation_post left this blank for them. */
function occupationLabel(wi: ResidentWorkInfo | null): string {
  if (!wi) return "";
  if (wi.occupation_post?.trim()) return wi.occupation_post;
  if (wi.occupation_status) {
    const opt = OCCUPATION_OPTIONS.find((o) => o.value === wi.occupation_status);
    return opt ? `${opt.am} / ${opt.en}` : wi.occupation_status;
  }
  return "";
}

function RentalHouseDetailPage() {
  const { houseId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const { data: house, isLoading } = useQuery({
    queryKey: ["rental-house", houseId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele_rental_house")
        .select(`*, kebele:kebele_id ( kebele_name_am, kebele_number )`)
        .eq("rental_house_id", houseId)
        .eq("woreda_id", woredaId!)
        .single();
      if (error) throw error;
      return data as unknown as {
        rental_house_id: string;
        house_number: string;
        address_line: string | null;
        monthly_rent_standard: number | null;
        occupancy_status: "vacant" | "occupied" | "under_maintenance";
        bedrooms: number | null;
        kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
      };
    },
  });

  const { data: occupancies } = useQuery({
    queryKey: ["rental-occupancies", houseId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_occupancy")
        .select(
          `occupancy_id, rent_start_date, rent_amount, status, termination_date, termination_reason, created_at,
           resident:resident_id ( resident_id, full_name_am, full_name )`,
        )
        .eq("rental_house_id", houseId)
        .eq("woreda_id", woredaId!)
        .order("rent_start_date", { ascending: false });
      if (error) throw error;

      // rental_occupancy_decrypted isn't in the generated types yet
      // (00000000000023_pii_encryption.sql) -- same untyped-client cast
      // pattern already used elsewhere in this codebase for pre-typegen
      // tables. Fetched separately: the select above embeds resident via a
      // FK-derived PostgREST join, which is not guaranteed to resolve
      // through a view the same way it does through the base table. Both
      // the active-occupancy card and the full history table below render
      // rent_amount, so every row's decrypted value is needed, not just one.
      const ids = (data ?? []).map((o) => o.occupancy_id);
      let decryptedRentById = new Map<string, number>();
      if (ids.length > 0) {
        const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
        const { data: amounts, error: amountsError } = await db
          .from("rental_occupancy_decrypted")
          .select("occupancy_id, rent_amount_decrypted")
          .in("occupancy_id", ids);
        if (amountsError) throw amountsError;
        decryptedRentById = new Map(
          (amounts ?? [])
            .filter(
              (r: { rent_amount_decrypted: number | null }) => r.rent_amount_decrypted != null,
            )
            .map((r: { occupancy_id: string; rent_amount_decrypted: number }) => [
              r.occupancy_id,
              r.rent_amount_decrypted,
            ]),
        );
      }
      return (data ?? []).map((o) => ({
        ...o,
        rent_amount: decryptedRentById.get(o.occupancy_id) ?? o.rent_amount,
      }));
    },
  });

  const { data: requests } = useQuery({
    queryKey: ["rental-requests-for-house", houseId],
    enabled: !!woredaId,
    queryFn: async () => {
      // rent_amount deliberately not selected -- unused in this list (only
      // request_number/type/resident/status render below); the decrypted
      // value lives in rental_occupancy_request_decrypted, not this base
      // table, so there's no reason to pull it for a field nothing here
      // displays.
      const { data, error } = await supabase
        .from("rental_occupancy_request")
        .select(
          `rental_request_id, request_number, request_type, status, rent_start_date, created_at,
           resident:resident_id ( full_name_am, full_name )`,
        )
        .eq("rental_house_id", houseId)
        .eq("woreda_id", woredaId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const active = (occupancies ?? []).find((o) => o.status === "active");

  const [assignOpen, setAssignOpen] = useState(false);
  const [vacateOpen, setVacateOpen] = useState(false);

  if (!hasPermission(P.RENTAL_VIEW)) return <Navigate to="/woreda/dashboard" />;
  if (isLoading || !house) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Building2}
        titleAm={`ቤት ቁ. ${house.house_number}`}
        titleEn={`House ${house.house_number}`}
        description={
          house.kebele?.kebele_name_am
            ? `${house.kebele.kebele_name_am} (#${house.kebele.kebele_number ?? ""})`
            : undefined
        }
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  to: "/woreda/rental-houses/$houseId/occupant-print",
                  params: { houseId },
                })
              }
            >
              <Printer className="mr-1 h-4 w-4" />
              <span className="font-noto-ethiopic">የተከራይ መገለጫ አትም</span>
              <span className="ml-1 opacity-80">/ Print occupant profile</span>
            </Button>
            {hasPermission(P.RENTAL_CREATE) && (
              <Button
                variant="outline"
                onClick={() =>
                  navigate({
                    to: "/woreda/rental-houses/$houseId/edit",
                    params: { houseId },
                  })
                }
              >
                <Pencil className="mr-1 h-4 w-4" /> Edit
              </Button>
            )}
            {hasPermission(P.RENTAL_CREATE) && house.occupancy_status !== "occupied" && (
              <Button onClick={() => setAssignOpen(true)}>
                <UserPlus className="mr-1 h-4 w-4" /> Assign occupant
              </Button>
            )}
            {hasPermission(P.RENTAL_VACATE) && house.occupancy_status === "occupied" && active && (
              <Button variant="destructive" onClick={() => setVacateOpen(true)}>
                <UserMinus className="mr-1 h-4 w-4" /> Vacate
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-slate-500">Occupancy</div>
          <div className="mt-1">
            <Badge
              variant={
                house.occupancy_status === "occupied"
                  ? "default"
                  : house.occupancy_status === "vacant"
                    ? "secondary"
                    : "outline"
              }
            >
              {house.occupancy_status}
            </Badge>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-slate-500">Monthly Rent</div>
          <div className="mt-1 text-lg font-semibold">
            {house.monthly_rent_standard != null
              ? Number(house.monthly_rent_standard).toLocaleString()
              : "—"}{" "}
            <span className="text-sm font-normal text-slate-500">ETB</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-slate-500">Bedrooms</div>
          <div className="mt-1 text-lg font-semibold">{house.bedrooms ?? "—"}</div>
        </Card>
      </div>

      {active && (
        <Card className="p-4">
          <div className="mb-2 font-noto-ethiopic text-sm font-semibold text-slate-700">
            አሁን ተከራይ / Current Occupant
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs text-slate-500">Name</div>
              <div className="font-noto-ethiopic">
                {active.resident?.full_name_am || active.resident?.full_name || "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Start</div>
              <div>{fmtDate(active.rent_start_date)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Rent</div>
              <div>{Number(active.rent_amount).toLocaleString()} ETB</div>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          <ScrollText className="mr-1 inline h-4 w-4" /> Occupancy History
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="px-4 py-2">Occupant</th>
                <th className="px-4 py-2">Start</th>
                <th className="px-4 py-2">End</th>
                <th className="px-4 py-2">Rent</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(occupancies ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No occupancy history.
                  </td>
                </tr>
              )}
              {(occupancies ?? []).map((o) => (
                <tr key={o.occupancy_id} className="border-t">
                  <td className="px-4 py-2 font-noto-ethiopic">
                    {o.resident?.full_name_am || o.resident?.full_name || "—"}
                  </td>
                  <td className="px-4 py-2">{fmtDate(o.rent_start_date)}</td>
                  <td className="px-4 py-2">{fmtDate(o.termination_date)}</td>
                  <td className="px-4 py-2">{Number(o.rent_amount).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <Badge variant={o.status === "active" ? "default" : "secondary"}>
                      {o.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">{o.termination_reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          Workflow Requests
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="px-4 py-2">Request #</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Occupant</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(requests ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No requests.
                  </td>
                </tr>
              )}
              {(requests ?? []).map((r) => (
                <tr key={r.rental_request_id} className="border-t">
                  <td className="px-4 py-2 font-medium">{r.request_number}</td>
                  <td className="px-4 py-2">{r.request_type}</td>
                  <td className="px-4 py-2 font-noto-ethiopic">
                    {r.resident?.full_name_am || r.resident?.full_name || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      to="/woreda/rental-houses/requests/$requestId"
                      params={{ requestId: r.rental_request_id }}
                      className="text-blue-700 hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {assignOpen && (
        <AssignDialog
          houseId={houseId}
          woredaId={woredaId!}
          actorUserId={actorUserId}
          defaultRent={Number(house.monthly_rent_standard ?? 0)}
          onClose={() => setAssignOpen(false)}
          onSuccess={() => {
            setAssignOpen(false);
            qc.invalidateQueries({ queryKey: ["rental-requests-for-house", houseId] });
          }}
        />
      )}
      {vacateOpen && active && (
        <VacateDialog
          houseId={houseId}
          woredaId={woredaId!}
          actorUserId={actorUserId}
          activeOccupancyId={active.occupancy_id}
          activeResidentId={
            (active.resident as unknown as { resident_id: string } | null)?.resident_id ?? ""
          }
          onClose={() => setVacateOpen(false)}
          onSuccess={() => {
            setVacateOpen(false);
            qc.invalidateQueries({ queryKey: ["rental-requests-for-house", houseId] });
          }}
        />
      )}
    </div>
  );
}

function AssignDialog({
  houseId,
  woredaId,
  actorUserId,
  defaultRent,
  onClose,
  onSuccess,
}: {
  houseId: string;
  woredaId: string;
  actorUserId: string | null;
  defaultRent: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [residentId, setResidentId] = useState("");
  const [placeOfBirth, setPlaceOfBirth] = useState("");
  const [dob, setDob] = useState("");
  const [occupation, setOccupation] = useState("");
  const [workAddress, setWorkAddress] = useState("");
  const [rentStart, setRentStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [rent, setRent] = useState(String(defaultRent || ""));

  const residentDetailQuery = useQuery({
    queryKey: ["assign-dialog-resident-detail", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select("resident_id, date_of_birth, birth_place, work_info")
        .eq("resident_id", residentId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        resident_id: string;
        date_of_birth: string | null;
        birth_place: ResidentBirthPlace | null;
        work_info: ResidentWorkInfo | null;
      } | null;
    },
  });

  useEffect(() => {
    const r = residentDetailQuery.data;
    if (!r) return;
    setDob(r.date_of_birth || "");
    setPlaceOfBirth(birthPlaceLabel(r.birth_place));
    setOccupation(occupationLabel(r.work_info));
    setWorkAddress(r.work_info?.work_address || "");
  }, [residentDetailQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!residentId) throw new Error("ተከራይ ይምረጡ / Select an occupant");
      if (!rentStart) throw new Error("የገባበት ቀን ያስፈልጋል / Rent start date required");
      if (!rent || Number(rent) <= 0)
        throw new Error("ልክ የቤት ኪራይ ያስገቡ / Enter a valid rent amount");
      const { data, error } = await supabase
        .from("rental_occupancy_request")
        .insert({
          woreda_id: woredaId,
          rental_house_id: houseId,
          resident_id: residentId,
          request_type: "new_registration",
          request_number: "",
          rent_start_date: rentStart,
          rent_amount: Number(rent),
          status: "submitted",
          requested_by_user_id: actorUserId,
        } as never)
        .select("rental_request_id, request_number")
        .single();
      if (error) throw error;
      const rid = (data as { rental_request_id: string }).rental_request_id;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "rental_occupancy_request",
        entity_id: rid,
        action_type: "RENTAL_REQUEST_CREATED",
        new_value_json: {
          request_type: "new_registration",
          place_of_birth: placeOfBirth,
          date_of_birth: dob,
          occupation,
          work_address: workAddress,
          rent_start_date: rentStart,
          rent_amount: Number(rent),
        } as never,
      });
      return rid;
    },
    onSuccess: () => {
      toast.success("ጥያቄ ተመዝግቧል / Request submitted");
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">የተከራይ ምዝገባ ጥያቄ</span>{" "}
            <span className="text-sm text-slate-500">/ New Occupancy Request</span>
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>
              <span className="font-noto-ethiopic">ሙሉ ስም</span>{" "}
              <span className="text-xs text-slate-500">/ Full Name (search registry)</span>
            </Label>
            <ResidentSearchPicker
              value={residentId}
              onChange={(id) => setResidentId(id)}
              woredaId={woredaId}
              placeholder="Search resident by name / ID"
            />
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">የትውልድ ዘመን</span>{" "}
              <span className="text-xs text-slate-500">/ DoB (ET)</span>
            </Label>
            <EthiopianDateInput value={dob} onChange={setDob} />
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">የትውልድ ስፍራ</span>{" "}
              <span className="text-xs text-slate-500">/ Place of Birth</span>
            </Label>
            <Input value={placeOfBirth} onChange={(e) => setPlaceOfBirth(e.target.value)} />
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">ስራ</span>{" "}
              <span className="text-xs text-slate-500">/ Occupation</span>
            </Label>
            <Input value={occupation} onChange={(e) => setOccupation(e.target.value)} />
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">የስራ አድራሻ</span>{" "}
              <span className="text-xs text-slate-500">/ Work Address</span>
            </Label>
            <Input value={workAddress} onChange={(e) => setWorkAddress(e.target.value)} />
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">የገባበት ቀን</span>{" "}
              <span className="text-xs text-slate-500">/ Rent Start (ET)</span>
            </Label>
            <EthiopianDateInput value={rentStart} onChange={setRentStart} />
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">የቤት ኪራይ መጠን</span>{" "}
              <span className="text-xs text-slate-500">/ Amount</span>
            </Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VacateDialog({
  houseId,
  woredaId,
  actorUserId,
  activeOccupancyId,
  activeResidentId,
  onClose,
  onSuccess,
}: {
  houseId: string;
  woredaId: string;
  actorUserId: string | null;
  activeOccupancyId: string;
  activeResidentId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [terminationDate, setTerminationDate] = useState("");
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!terminationDate) throw new Error("የመተው ቀን ያስፈልጋል / End date required");
      if (reason.trim().length < 3) throw new Error("ምክንያት ያስፈልጋል / Reason required");
      const { data, error } = await supabase
        .from("rental_occupancy_request")
        .insert({
          woreda_id: woredaId,
          rental_house_id: houseId,
          resident_id: activeResidentId,
          request_type: "termination",
          request_number: "",
          termination_date: terminationDate,
          termination_reason: reason.trim(),
          existing_occupancy_id: activeOccupancyId,
          status: "submitted",
          requested_by_user_id: actorUserId,
        } as never)
        .select("rental_request_id")
        .single();
      if (error) throw error;
      const rid = (data as { rental_request_id: string }).rental_request_id;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "rental_occupancy_request",
        entity_id: rid,
        action_type: "RENTAL_VACATE_REQUESTED",
        new_value_json: {
          termination_date: terminationDate,
          termination_reason: reason.trim(),
        } as never,
      });
      return rid;
    },
    onSuccess: () => {
      toast.success("የመተው ጥያቄ ተልኳል / Vacate request submitted");
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">የመተው ጥያቄ</span>{" "}
            <span className="text-sm text-slate-500">/ Vacate Occupancy</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Termination date (ET)</Label>
            <EthiopianDateInput value={terminationDate} onChange={setTerminationDate} />
          </div>
          <div>
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            Submit Vacate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
