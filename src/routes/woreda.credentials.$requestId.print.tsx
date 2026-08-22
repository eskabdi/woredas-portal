import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReactToPrint } from "react-to-print";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";

import { credentialVerifyUrl } from "@/config/credentialCryptoConfig";
import { CredentialBarcode } from "@/components/credentials/CredentialBarcode";

import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Printer,
  ShieldCheck,
  XCircle,
  BadgeCheck,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/common/PermissionGate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";

export const Route = createFileRoute("/woreda/credentials/$requestId/print")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.CREDENTIAL_PRINT}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to print credentials.</p>
        </div>
      }
    >
      <PrintPage />
    </PermissionGate>
  ),
});

interface TemplateField {
  field_key: string;
  template_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number | null;
  font_weight: string | null;
  text_align: string | null;
  z_index: number;
  canvas_width: number;
  canvas_height: number;
}

/** The subset of each joined row the front/back card previews actually read. */
interface CardResident {
  phone_number: string | null;
  full_name: string | null;
  full_name_am: string | null;
  sex: string | null;
}

interface CardCredential {
  credential_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  qr_payload: string | null;
}

interface CardWoreda {
  woreda_name_am: string | null;
  woreda_name_en: string | null;
}

interface CardWoredaSettings {
  woreda_name_display: string | null;
  woreda_name_display_en?: string | null;
  woreda_name_display_har?: string | null;
  woreda_name_display_om?: string | null;
}

interface CardKebele {
  kebele_name_am: string | null;
  kebele_name_en: string | null;
  kebele_number: string | number | null;
}

interface CardHousehold {
  house_number: string | null;
}

// A signed credential token is two base64url segments joined by a dot:
// payload.signature. There is no JWT header — the algorithm is pinned in code,
// so a token cannot claim its own.
//
// If the token is missing or malformed we must NEVER silently fall back to a
// plain credential_number QR — a forgeable-looking QR must never be printed.
// Callers must gate rendering with isSignedToken() and show the "not yet
// signed" block instead.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
function isSignedToken(v: string | null | undefined): v is string {
  return typeof v === "string" && TOKEN_SHAPE.test(v);
}

// CSS treats 1mm as 96/25.4 px, and the card prints at a fixed 85.6mm, so a
// millimetre size here is a real millimetre on the finished card.
const mmToPx = (mm: number) => Math.round((mm / 25.4) * 96);

/**
 * Printed size of the verification QR.
 *
 * 24mm, not the 19mm this used to be. At 19mm the modules came out about 1.3
 * dots wide on a 300 dpi card printer — finer than the printer can resolve, so
 * the grid smeared and the code would not scan no matter how good the camera
 * was. 24mm puts roughly 3.9 printer dots behind every module.
 */
const QR_PRINT_MM = 24;
const QR_PRINT_PX = mmToPx(QR_PRINT_MM);

/** Physical width of a CR80 card, used to turn template canvas px into mm. */
const CARD_WIDTH_MM = 85.6;

// If the QR encoder still throws (e.g. payload exceeds even level-L v40
// capacity ~2953 binary chars), render a visible red error placeholder —
// NOT a plain-text fallback QR.
class QRBoundary extends React.Component<
  { size: number; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* rendered as visible error */
  }
  render() {
    if (this.state.failed) {
      return (
        <div
          className="flex items-center justify-center border border-red-300 bg-red-50 text-center text-[8px] font-semibold text-red-700"
          style={{ width: this.props.size, height: this.props.size }}
        >
          QR
          <br />
          encode
          <br />
          failed
        </div>
      );
    }
    return this.props.children;
  }
}

const PRINTERS = ["PVC Card Printer-XP80", "Zebra ZC300", "Evolis Primacy 2", "Fargo DTC1250e"];
const QUALITIES = ["Standard", "High", "Ultra"];

function PrintPage() {
  const { requestId } = Route.useParams();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const reqQuery = useQuery({
    queryKey: ["credential-print-request", requestId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credential_request")
        .select(
          `credential_request_id, request_number, status, credential_id, resident_id, household_id, woreda_id,
           approved_by_user_id, payment_id,
           resident:resident_id (
             resident_id, resident_number, national_id_no, full_name, full_name_am,
             sex, date_of_birth, photo_url, residency_status, active_flag, phone_number
           ),
           household:household_id (
             household_id, house_number,
             kebele:kebele_id ( kebele_name_am, kebele_name_en, kebele_number )
           )`,
        )
        .eq("credential_request_id", requestId)
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const request = reqQuery.data;

  const credQuery = useQuery({
    queryKey: ["credential-for-print", request?.credential_id],
    enabled: !!request?.credential_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residence_credential")
        .select(
          "credential_id, credential_number, serial_number, qr_payload, status, issue_date, expiry_date, credential_type",
        )
        .eq("credential_id", request!.credential_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const cred = credQuery.data;

  const woredaQuery = useQuery({
    queryKey: ["woreda-for-print", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda")
        .select("woreda_name_am, woreda_name_en")
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["woreda-settings-for-print", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda_settings")
        .select(
          "logo_url, stamp_url, supervisor_signature_url, woreda_name_display, woreda_name_display_en, woreda_name_display_har, woreda_name_display_om",
        )
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const templateQuery = useQuery({
    queryKey: ["id-card-template"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("id_card_template_field")
        .select(
          "field_key, template_type, x, y, width, height, font_size, font_weight, text_align, z_index, canvas_width, canvas_height",
        );
      if (error) throw error;
      return (data ?? []) as TemplateField[];
    },
  });

  const templateBgQuery = useQuery({
    queryKey: ["id-card-template-bg"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("id_card_template")
        .select("template_type, background_image_url, status");
      if (error) throw error;
      return data ?? [];
    },
  });

  const priorPrintsQuery = useQuery({
    queryKey: ["credential-print-log", request?.credential_id],
    enabled: !!request?.credential_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credential_print_log")
        .select("credential_print_log_id, print_type, printed_at, is_reprint")
        .eq("credential_id", request!.credential_id!)
        .order("printed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const residentPhotoPath = (request?.resident as any)?.photo_url as string | null | undefined;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!residentPhotoPath) {
        if (!cancelled) setPhotoUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from("resident-photos")
        .createSignedUrl(residentPhotoPath, 900);
      if (!cancelled) setPhotoUrl(data?.signedUrl ?? null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [residentPhotoPath]);

  // Signed URLs for tenant-assets (logo + signature) and credential-templates
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const s = settingsQuery.data;
      if (s?.logo_url) {
        const { data } = await supabase.storage
          .from("tenant-assets")
          .createSignedUrl(s.logo_url, 900);
        if (!cancelled) setLogoUrl(data?.signedUrl ?? null);
      } else if (!cancelled) setLogoUrl(null);
      if (s?.supervisor_signature_url) {
        const { data } = await supabase.storage
          .from("tenant-assets")
          .createSignedUrl(s.supervisor_signature_url, 900);
        if (!cancelled) setSignatureUrl(data?.signedUrl ?? null);
      } else if (!cancelled) setSignatureUrl(null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [settingsQuery.data]);

  const [frontBgUrl, setFrontBgUrl] = useState<string | null>(null);
  const [backBgUrl, setBackBgUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const rows = templateBgQuery.data ?? [];
      for (const r of rows) {
        if (!r.background_image_url) continue;
        const { data } = await supabase.storage
          .from("credential-templates")
          .createSignedUrl(r.background_image_url, 900);
        if (cancelled) return;
        if (r.template_type === "card_front") setFrontBgUrl(data?.signedUrl ?? null);
        if (r.template_type === "card_back") setBackBgUrl(data?.signedUrl ?? null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [templateBgQuery.data]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resident = request?.resident as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const household = request?.household as any;
  const kebele = household?.kebele;
  const woreda = woredaQuery.data;
  const settings = settingsQuery.data;

  const priorCount = priorPrintsQuery.data?.length ?? 0;
  const isReprint = priorCount > 0;

  const checks = useMemo(
    () => [
      {
        key: "approved",
        labelAm: "ጥያቄው ጸድቋል",
        labelEn: "Request has been approved",
        ok: !!request?.approved_by_user_id,
      },
      {
        key: "paid",
        labelAm: "ክፍያ ተሰብስቧል",
        labelEn: "Payment collected",
        ok: !!request?.payment_id && request?.status === "paid",
      },
      {
        key: "ready",
        labelAm: "ማስረጃው ተፈርሟል እና ዝግጁ ነው",
        labelEn: "Credential signed and ready to print",
        ok: !!cred?.qr_payload && (cred?.status === "ready_to_print" || cred?.status === "active"),
      },
      {
        key: "resident_ok",
        labelAm: "ነዋሪው ንቁ እና አልታገደም",
        labelEn: "Resident is active and not suspended",
        ok:
          !!resident && resident.residency_status !== "suspended" && resident.active_flag !== false,
      },
    ],
    [request, cred, resident],
  );
  const allAuthorized = checks.every((c) => c.ok);

  const [reprintReason, setReprintReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sidebar controls
  const [printerName, setPrinterName] = useState<string>(PRINTERS[0]);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  const [quality, setQuality] = useState<string>("High");
  const [verified, setVerified] = useState(false);

  const cardsRef = useRef<HTMLDivElement>(null);
  const doPrint = useReactToPrint({
    contentRef: cardsRef,
    documentTitle: cred?.credential_number ? `credential-${cred.credential_number}` : "credential",
    pageStyle: `@page { size: ${orientation === "portrait" ? "54mm 85.6mm" : "85.6mm 54mm"}; margin: 0; } @media print { html, body { margin: 0 !important; padding: 0 !important; width: ${orientation === "portrait" ? "54mm" : "85.6mm"}; height: ${orientation === "portrait" ? "85.6mm" : "54mm"}; } }`,
  });

  const handlePrint = async () => {
    if (!request || !cred || !actorUserId || !woredaId) return;
    if (!allAuthorized || !verified) return;
    if (isReprint && reprintReason.trim().length < 5) {
      toast.error("Reprint reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error: logErr } = await supabase.from("credential_print_log").insert({
        woreda_id: woredaId,
        credential_id: cred.credential_id,
        printed_by_user_id: actorUserId,
        print_type: cred.credential_type ?? "card",
        print_reason: isReprint ? "reprint" : "initial_issue",
        is_reprint: isReprint,
        reprint_reason: isReprint ? reprintReason.trim() : null,
        copies_count: 1,
        printer_name: printerName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (logErr) throw logErr;

      if (!isReprint && cred.status === "ready_to_print") {
        const { error: credErr } = await supabase
          .from("residence_credential")
          .update({ status: "printed", printed_at: nowIso })
          .eq("credential_id", cred.credential_id);
        if (credErr) throw credErr;

        await supabase.from("credential_status_history").insert({
          credential_id: cred.credential_id,
          old_status: "ready_to_print",
          new_status: "printed",
          changed_by_user_id: actorUserId,
          change_reason: "Credential printed",
        });

        await supabase
          .from("credential_request")
          .update({ status: "printed" })
          .eq("credential_request_id", request.credential_request_id);

        await supabase.from("credential_request_status_history").insert({
          credential_request_id: request.credential_request_id,
          old_status: "paid",
          new_status: "printed",
          changed_by_user_id: actorUserId,
          change_reason: "Credential printed",
        });
      }

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "residence_credential",
        entity_id: cred.credential_id,
        action_type: isReprint ? "CREDENTIAL_REPRINTED" : "CREDENTIAL_PRINTED",
        new_value_json: {
          credential_id: cred.credential_id,
          credential_number: cred.credential_number,
          credential_request_id: request.credential_request_id,
          request_number: request.request_number,
          reprint_reason: isReprint ? reprintReason.trim() : null,
          reprint_index: isReprint ? priorCount + 1 : 0,
          printer_name: printerName,
          orientation,
          quality,
          printed_at: nowIso,
        } as never,
        action_at: nowIso,
      });

      doPrint?.();
      toast.success(`ህትመት ተጀምሯል / Printing job sent to ${printerName}`);
      setConfirmOpen(false);
      setReprintReason("");
      queryClient.invalidateQueries({ queryKey: ["credential-print-log", cred.credential_id] });
      queryClient.invalidateQueries({ queryKey: ["credential-for-print", cred.credential_id] });
      queryClient.invalidateQueries({
        queryKey: ["credential-request", request.credential_request_id],
      });
    } catch (e) {
      toast.error(`Print failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const queryError = reqQuery.error || credQuery.error || templateQuery.error || woredaQuery.error;
  if (queryError) {
    return (
      <ErrorPanel
        titleAm="የመረጃ ጭነት አልተሳካም"
        titleEn="Failed to load credential data"
        message={(queryError as Error).message}
        hint="This usually means a database column was renamed or a row is missing. Please report this to your administrator."
        onBack={() => navigate({ to: "/woreda/credentials" })}
      />
    );
  }

  if (reqQuery.isLoading || credQuery.isLoading || templateQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!request) {
    return (
      <ErrorPanel
        titleAm="ጥያቄው አልተገኘም"
        titleEn="Request not found"
        message={`No credential request with id ${requestId} was found for this woreda.`}
        onBack={() => navigate({ to: "/woreda/credentials" })}
      />
    );
  }

  if (!request.credential_id || !cred) {
    return (
      <ErrorPanel
        titleAm="ማስረጃው ገና አልተፈጠረም"
        titleEn="Credential not yet generated"
        message="The credential row has not been created for this request. Complete payment and QR signing before opening the print preview."
        onBack={() => navigate({ to: "/woreda/credentials/$requestId", params: { requestId } })}
      />
    );
  }

  // Data-shape guardrail: the print flow depends on these fields existing.
  // If a schema rename ever drops them we fail fast with an actionable message
  // instead of leaving the preview stuck in a loading spinner.
  const missing: string[] = [];
  if (!cred.credential_number) missing.push("residence_credential.credential_number");
  if (!resident) missing.push("credential_request.resident");
  else if (!("residency_status" in resident)) missing.push("resident.residency_status");
  if (missing.length > 0) {
    return (
      <ErrorPanel
        titleAm="የመረጃ አወቃቀር ስህተት"
        titleEn="Data shape mismatch"
        message={`The following expected fields are missing or empty: ${missing.join(", ")}`}
        hint="A database column may have been renamed. Update the print page query or restore the field."
        onBack={() => navigate({ to: "/woreda/credentials/$requestId", params: { requestId } })}
      />
    );
  }

  // Signed-token guardrail — never allow printing (and never render a
  // real QR) when the stored qr_payload is missing or not JWT-shaped.
  if (!isSignedToken(cred.qr_payload)) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
          <div className="font-noto-ethiopic text-lg font-semibold text-amber-900">
            ማስረጃው ገና አልተፈረመም
          </div>
          <div className="mt-1 text-sm text-amber-800">
            / Credential is not yet signed — please wait or retry
          </div>
          <p className="mt-3 text-sm text-amber-900/90">
            እባክዎ ይጠብቁ ወይም ዳግም ይሞክሩ። The signed QR token has not been generated for this credential
            yet, so printing is blocked to prevent an unsigned card from being issued.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["credential-for-print", request.credential_id],
                });
                toast.info("Refreshed — checking signing status");
              }}
              className="bg-amber-600 hover:bg-amber-700"
            >
              <span className="font-noto-ethiopic">ዳግም ሞክር</span>
              <span className="ml-2 text-xs text-white/80">/ Retry</span>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  to: "/woreda/credentials/$requestId",
                  params: { requestId },
                })
              }
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              <span className="font-noto-ethiopic">ወደ ጥያቄው</span>
              <span className="ml-2 text-xs text-slate-500">
                / Back to request (re-run signing)
              </span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const dobEthiopian = resident?.date_of_birth
    ? formatEthiopianDate(new Date(resident.date_of_birth))
    : "";
  const dobGregorian = resident?.date_of_birth ?? "";
  const issueEth = cred.issue_date ? formatEthiopianDate(new Date(cred.issue_date)) : "";
  const expiryEth = cred.expiry_date ? formatEthiopianDate(new Date(cred.expiry_date)) : "";

  const canPrint =
    allAuthorized && verified && !busy && (!isReprint || reprintReason.trim().length >= 5);

  // Shared by the on-screen preview and the hidden print surface, so both
  // read the same field layout and the same resolved values -- previously
  // the preview pane never consumed these at all (it only ever rendered
  // CardFront/CardBack), which is how the two surfaces drifted out of sync.
  const frontFields = (templateQuery.data ?? []).filter((f) => f.template_type === "card_front");
  const backFields = (templateQuery.data ?? []).filter((f) => f.template_type === "card_back");
  const fieldValues = buildFieldValues(
    request,
    cred,
    resident,
    household,
    kebele,
    woreda,
    settings,
    dobEthiopian,
    dobGregorian,
    issueEth,
    expiryEth,
  );

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PageHeader
          variant="plain"
          icon={Printer}
          titleAm="የመታወቂያ ህትመት"
          titleEn="Credential Printing"
          actions={
            <Button asChild variant="outline">
              <Link to="/woreda/credentials/$requestId" params={{ requestId }}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to request
              </Link>
            </Button>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)] no-print">
        {/* Sidebar */}
        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="rounded-t-xl bg-blue-700 px-4 py-3 text-white">
              <span className="font-noto-ethiopic text-sm font-semibold">የህትመት መቆጣጠሪያዎች</span>
              <span className="ml-2 text-xs text-white/80">/ Print Controls</span>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <Label className="text-xs">
                  <span className="font-noto-ethiopic">አታሚ</span>
                  <span className="ml-1 text-slate-500">/ Printer</span>
                </Label>
                <Select value={printerName} onValueChange={setPrinterName}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRINTERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">
                  <span className="font-noto-ethiopic">የወረቀት መጠን</span>
                  <span className="ml-1 text-slate-500">/ Paper Size</span>
                </Label>
                <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Standard PVC (85.6 × 54 mm)
                </div>
              </div>

              <div>
                <Label className="text-xs">
                  <span className="font-noto-ethiopic">አቅጣጫ</span>
                  <span className="ml-1 text-slate-500">/ Orientation</span>
                </Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(["landscape", "portrait"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOrientation(o)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium capitalize transition ${
                        orientation === o
                          ? "border-blue-600 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">
                  <span className="font-noto-ethiopic">ጥራት</span>
                  <span className="ml-1 text-slate-500">/ Quality</span>
                </Label>
                <Select value={quality} onValueChange={setQuality}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUALITIES.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                <Checkbox
                  checked={verified}
                  onCheckedChange={(v) => setVerified(v === true)}
                  className="mt-0.5"
                />
                <span className="text-xs leading-snug">
                  <span className="font-noto-ethiopic font-medium text-slate-900">
                    መረጃው ትክክል መሆኑን አረጋግጣለሁ
                  </span>
                  <span className="block text-slate-500">
                    / I verify the information is correct
                  </span>
                </span>
              </label>

              <div className="space-y-2">
                <Button
                  className="w-full bg-blue-700 hover:bg-blue-800"
                  disabled={!canPrint}
                  onClick={() => setConfirmOpen(true)}
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="mr-2 h-4 w-4" />
                  )}
                  <span className="font-noto-ethiopic">ማተም</span>
                  <span className="ml-2 text-xs text-white/80">/ Print</span>
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    navigate({ to: "/woreda/credentials/$requestId", params: { requestId } })
                  }
                >
                  <span className="font-noto-ethiopic">መተው</span>
                  <span className="ml-2 text-xs text-slate-500">/ Cancel</span>
                </Button>
              </div>

              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                <ShieldCheck className="h-3 w-3" />
                <span>All prints are audit-logged</span>
              </div>
            </div>
          </section>

          {/* Authorization checklist */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="rounded-t-xl bg-slate-800 px-4 py-3 text-white">
              <span className="font-noto-ethiopic text-sm font-semibold">የህትመት ፍቃድ</span>
              <span className="ml-2 text-xs text-white/80">/ Print Authorization</span>
            </div>
            <div className="space-y-3 p-4">
              <ul className="space-y-2">
                {checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    )}
                    <div>
                      <div className="font-noto-ethiopic text-xs font-medium text-slate-900">
                        {c.labelAm}
                      </div>
                      <div className="text-[10px] text-slate-500">/ {c.labelEn}</div>
                    </div>
                  </li>
                ))}
              </ul>

              {isReprint && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                  <div className="font-noto-ethiopic text-xs font-semibold text-amber-900">
                    ተደጋጋሚ ህትመት ({priorCount})
                  </div>
                  <div className="text-[10px] text-amber-800">
                    / Reprint — previously printed {priorCount}{" "}
                    {priorCount === 1 ? "time" : "times"}
                  </div>
                  <Label htmlFor="reprint-reason" className="mt-3 block text-[10px]">
                    <span className="font-noto-ethiopic">የተደጋጋሚ ህትመት ምክንያት</span>
                    <span className="ml-1 text-slate-500">/ Reprint reason</span>
                  </Label>
                  <Textarea
                    id="reprint-reason"
                    value={reprintReason}
                    onChange={(e) => setReprintReason(e.target.value)}
                    rows={3}
                    className="mt-1"
                    placeholder="Lost / damaged / reissue…"
                  />
                </div>
              )}
            </div>
          </section>
        </aside>

        {/* Preview */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="rounded-t-xl bg-blue-700 px-5 py-3 text-white">
            <span className="font-noto-ethiopic text-base font-semibold">ቅድመ ዕይታ</span>
            <span className="ml-2 text-sm text-white/80">/ Card Preview</span>
          </div>
          <div className="space-y-6 bg-slate-50 p-6">
            {/* CardFront is a hand-styled fallback for a tenant that hasn't
                uploaded a template background yet. Once one is set, the
                background's own artwork carries the field labels, so the
                preview has to switch to the same field-positioned renderer
                the physical card prints with (PrintableCard) -- otherwise
                the background shows through with none of its labels' values
                actually filled in, which is what the fallback used to do. */}
            {frontBgUrl ? (
              <PrintableCard
                side="front"
                fields={frontFields}
                values={fieldValues}
                photoUrl={photoUrl}
                qrPayload={null}
                credentialNumber={cred?.credential_number ?? null}
                bgUrl={frontBgUrl}
                previewMode
              />
            ) : (
              <CardFront
                resident={resident}
                cred={cred}
                woreda={woreda}
                settings={settings}
                photoUrl={photoUrl}
                logoUrl={logoUrl}
                dobEthiopian={dobEthiopian}
                dobGregorian={dobGregorian}
                issueEth={issueEth}
                bgUrl={frontBgUrl}
                orientation={orientation}
              />
            )}
            {backBgUrl ? (
              <PrintableCard
                side="back"
                fields={backFields}
                values={fieldValues}
                photoUrl={photoUrl}
                qrPayload={cred.qr_payload as string | null}
                credentialNumber={cred?.credential_number ?? null}
                bgUrl={backBgUrl}
                previewMode
              />
            ) : (
              <CardBack
                cred={cred}
                kebele={kebele}
                household={household}
                signatureUrl={signatureUrl}
                expiryEth={expiryEth}
                bgUrl={backBgUrl}
                orientation={orientation}
              />
            )}
          </div>
        </section>
      </div>

      {/* Hidden print surface — retains legacy template-driven layout */}
      <div className="hidden print:block">
        <div ref={cardsRef} id="printable-card-frame">
          <div style={{ pageBreakAfter: "always" }}>
            <PrintableCard
              side="front"
              fields={frontFields}
              values={fieldValues}
              photoUrl={photoUrl}
              qrPayload={null}
              credentialNumber={cred?.credential_number ?? null}
              bgUrl={frontBgUrl}
            />
          </div>
          <div>
            <PrintableCard
              side="back"
              fields={backFields}
              values={fieldValues}
              photoUrl={photoUrl}
              qrPayload={cred.qr_payload as string | null}
              credentialNumber={cred?.credential_number ?? null}
              bgUrl={backBgUrl}
            />
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <span className="font-noto-ethiopic">ህትመትን ያረጋግጡ</span>
              <span className="ml-2 text-sm text-slate-500">/ Confirm Print</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isReprint
                ? `This will be reprint #${priorCount + 1}. A permanent audit record will be created.`
                : "This will mark the credential as printed and create a permanent audit record."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                handlePrint();
              }}
              className="bg-blue-700 hover:bg-blue-800"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm &amp; Print
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <style>{`
        @page { size: 85.6mm 54mm; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
          body * { visibility: hidden !important; }
          #printable-card-frame, #printable-card-frame * { visibility: visible !important; }
          #printable-card-frame {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 85.6mm !important;
            height: 54mm !important;
            display: block !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ============ Preview visuals ============ */

function CardFront({
  resident,
  cred,
  woreda,
  settings,
  photoUrl,
  logoUrl,
  dobEthiopian,
  dobGregorian,
  issueEth,
  bgUrl,
  orientation,
}: {
  resident: CardResident | null | undefined;
  cred: CardCredential | null | undefined;
  woreda: CardWoreda | null | undefined;
  settings: CardWoredaSettings | null | undefined;
  photoUrl: string | null;
  logoUrl: string | null;
  dobEthiopian: string;
  dobGregorian: string;
  issueEth: string;
  bgUrl: string | null;
  orientation: "portrait" | "landscape";
}) {
  const isPortrait = orientation === "portrait";
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-xl shadow-lg ring-1 ring-slate-200"
      style={{
        width: "min(100%, 640px)",
        aspectRatio: isPortrait ? "54 / 85.6" : "85.6 / 54",
        background: bgUrl
          ? `url(${bgUrl}) center/cover no-repeat`
          : "linear-gradient(135deg,#1d4ed8 0%,#1e3a8a 100%)",
        fontFamily: "'Noto Sans Ethiopic','Inter',system-ui,sans-serif",
      }}
    >
      {!bgUrl && (
        <>
          <div className="absolute inset-x-0 top-0 flex items-center gap-3 bg-blue-800/90 px-4 py-3 text-white">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-9 w-9 rounded-full bg-white p-0.5" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                HR
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <div className="truncate font-noto-ethiopic text-[11px] font-semibold">
                {settings?.woreda_name_display || woreda?.woreda_name_am || "የሐረሪ ክልል"}
              </div>
              <div className="truncate text-[10px] text-blue-100">
                {woreda?.woreda_name_en ?? "Harari Region"} — Woreda Administration
              </div>
              <div className="text-[9px] uppercase tracking-wider text-blue-200">
                Resident ID Card
              </div>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-[34px] top-[68px] bg-white/95 px-4 pt-3 text-slate-900">
            <div className="flex gap-4">
              <div className="h-24 w-20 shrink-0 overflow-hidden rounded border-2 border-white bg-slate-200 shadow">
                {photoUrl ? (
                  <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-slate-500">
                    No photo
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-1">
                  <span className="font-noto-ethiopic truncate text-sm font-bold">
                    {resident?.full_name_am || resident?.full_name || "—"}
                  </span>
                  <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                </div>
                {resident?.full_name_am && resident?.full_name && (
                  <div className="truncate text-[11px] text-slate-500">{resident.full_name}</div>
                )}
                <FrontRow
                  labelAm="መ.ቁ"
                  labelEn="ID No."
                  value={cred?.credential_number ?? "—"}
                  mono
                />
                <FrontRow
                  labelAm="ጾታ"
                  labelEn="Gender"
                  value={resident?.sex === "female" ? "ሴት / Female" : "ወንድ / Male"}
                />
                <FrontRow
                  labelAm="የልደት ቀን"
                  labelEn="Date of Birth"
                  value={
                    dobEthiopian || dobGregorian
                      ? `${dobEthiopian}${dobGregorian ? ` (${dobGregorian})` : ""}`
                      : "—"
                  }
                />
                <FrontRow labelAm="የተሰጠበት" labelEn="Issue Date" value={issueEth || "—"} />
              </div>
            </div>
          </div>

          {/* Machine-readable credential number. Code 128 rather than Code 39:
              the number is all digits, which Set C packs two per symbol, so it
              fits this strip at a density a card printer can hold. */}
          <div className="absolute inset-x-0 bottom-0 flex h-[34px] items-center justify-center bg-white/95">
            <CredentialBarcode credentialNumber={cred?.credential_number} />
          </div>
        </>
      )}
    </div>
  );
}

function FrontRow({
  labelAm,
  labelEn,
  value,
  mono,
}: {
  labelAm: string;
  labelEn: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="font-noto-ethiopic w-24 shrink-0 text-slate-500">
        {labelAm} <span className="text-slate-400">/ {labelEn}</span>
      </span>
      <span className={`truncate font-medium text-slate-900 ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function CardBack({
  cred,
  kebele,
  household,
  signatureUrl,
  expiryEth,
  bgUrl,
  orientation,
}: {
  cred: CardCredential;
  kebele: CardKebele | null | undefined;
  household: CardHousehold | null | undefined;
  signatureUrl: string | null;
  expiryEth: string;
  bgUrl: string | null;
  orientation: "portrait" | "landscape";
}) {
  const isPortrait = orientation === "portrait";
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"
      style={{
        width: "min(100%, 640px)",
        aspectRatio: isPortrait ? "54 / 85.6" : "85.6 / 54",
        background: bgUrl ? `url(${bgUrl}) center/cover no-repeat` : "#ffffff",
        fontFamily: "'Noto Sans Ethiopic','Inter',system-ui,sans-serif",
      }}
    >
      {!bgUrl && (
        <div className="flex h-full flex-col p-4 text-slate-900">
          <div className="mb-3 border-b border-slate-200 pb-2">
            <div className="font-noto-ethiopic text-xs font-bold text-blue-800">የነዋሪው አድራሻ</div>
            <div className="text-[10px] text-slate-500">/ Residential Address</div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-slate-400">
                <span className="font-noto-ethiopic">ቀበሌ</span> / Kebele
              </div>
              <div className="mt-0.5 font-medium">
                {kebele?.kebele_name_am ?? "—"}
                {kebele?.kebele_number != null ? ` (#${kebele.kebele_number})` : ""}
              </div>
              {kebele?.kebele_name_en && (
                <div className="text-[9px] text-slate-500">{kebele.kebele_name_en}</div>
              )}
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-slate-400">
                <span className="font-noto-ethiopic">የቤት ቁጥር</span> / House No.
              </div>
              <div className="mt-0.5 font-medium">{household?.house_number ?? "—"}</div>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5">
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="font-noto-ethiopic font-semibold text-amber-900">
                የሚያበቃበት ቀን <span className="text-amber-700">/ Expiry</span>
              </span>
              <span className="font-mono text-[11px] font-bold text-red-700">
                {expiryEth || cred.expiry_date || "—"}
              </span>
            </div>
          </div>

          <div className="mt-3 grid flex-1 grid-cols-[auto_1fr] items-end gap-3">
            <div className="flex flex-col items-center">
              <div className="rounded bg-white p-1.5 shadow-sm ring-1 ring-slate-200">
                {isSignedToken(cred.qr_payload) ? (
                  <QRBoundary size={QR_PRINT_PX}>
                    <QRCodeCanvas
                      value={credentialVerifyUrl(cred.qr_payload)}
                      size={QR_PRINT_PX}
                      level="L"
                    />
                  </QRBoundary>
                ) : (
                  <div
                    className="flex items-center justify-center border border-amber-300 bg-amber-50 text-center text-[8px] font-medium text-amber-800"
                    style={{ width: QR_PRINT_PX, height: QR_PRINT_PX }}
                  >
                    Not signed
                  </div>
                )}
              </div>
              <div className="mt-1 text-center font-noto-ethiopic text-[9px] font-medium text-slate-600">
                የማረጋገጫ ኮድ
              </div>
              <div className="text-[8px] text-slate-400">/ Verify Authenticity</div>
            </div>

            <div className="flex flex-col items-end">
              <div className="h-14 w-40 border-b border-slate-400">
                {signatureUrl && (
                  <img src={signatureUrl} alt="" className="h-full w-full object-contain" />
                )}
              </div>
              <div className="mt-1 text-right font-noto-ethiopic text-[9px] font-medium text-slate-700">
                የወረዳ አስተዳዳሪ
              </div>
              <div className="text-right text-[8px] text-slate-500">/ Woreda Administrator</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ Printable (template-driven, unchanged behavior) ============ */

function buildFieldValues(
  _request: unknown,
  cred: CardCredential & { serial_number: string | null },
  resident:
    | (CardResident & { national_id_no: string | null; resident_number: string | null })
    | null
    | undefined,
  household: CardHousehold | null | undefined,
  kebele: CardKebele | null | undefined,
  woreda: CardWoreda | null | undefined,
  settings: CardWoredaSettings | null | undefined,
  dobEth: string,
  dobGreg: string,
  issueEth: string,
  expiryEth: string,
): Record<string, string> {
  return {
    full_name_am: resident?.full_name_am ?? "",
    full_name_en: resident?.full_name ?? "",
    id_number:
      cred?.credential_number || resident?.national_id_no || resident?.resident_number || "",
    gender: resident?.sex === "female" ? "ሴት / Female" : "ወንድ / Male",
    dob_ethiopian: dobEth,
    dob_gregorian: dobGreg,
    woreda_name: `${woreda?.woreda_name_am ?? ""} / ${woreda?.woreda_name_en ?? ""}`,
    // No raw woreda.woreda_name_har/om registry column exists (unlike
    // Amharic/English) -- these are settings-only overrides, so an unset
    // value just renders blank rather than falling back to anything.
    woreda_name_har: settings?.woreda_name_display_har ?? "",
    woreda_name_om: settings?.woreda_name_display_om ?? "",
    kebele_name: `${kebele?.kebele_name_am ?? ""} / ${kebele?.kebele_name_en ?? ""}`,
    house_number: household?.house_number ?? "",
    issue_date: issueEth ? `${issueEth} (${cred?.issue_date ?? ""})` : "",
    expiry_date: expiryEth ? `${expiryEth} (${cred?.expiry_date ?? ""})` : "",
    // The issuing entity is the tenant's configured display name, not
    // necessarily the raw registry name -- see woreda_settings.
    place_of_issue: `${settings?.woreda_name_display || woreda?.woreda_name_am || ""} / ${settings?.woreda_name_display_en || woreda?.woreda_name_en || ""}`,
    phone_number: resident?.phone_number ?? "",
    serial_number: cred?.serial_number ?? "",
  };
}

function PrintableCard({
  fields,
  values,
  photoUrl,
  qrPayload,
  credentialNumber,
  bgUrl,
  previewMode,
}: {
  side: "front" | "back";
  fields: TemplateField[];
  values: Record<string, string>;
  photoUrl: string | null;
  qrPayload: string | null;
  credentialNumber: string | null;
  bgUrl: string | null;
  /** On-screen preview pane, not the physical print surface -- sizes for
   * legibility on a monitor instead of the card's true millimetre width.
   * Every field position below is already percentage/cqh-based, so this
   * only changes the container's own size, not the layout math. */
  previewMode?: boolean;
}) {
  const canvasW = fields[0]?.canvas_width ?? 1688;
  const canvasH = fields[0]?.canvas_height ?? 1063;
  return (
    <div
      className={previewMode ? "mx-auto rounded-xl shadow-lg ring-1 ring-slate-200" : undefined}
      style={{
        position: "relative",
        // Physical width, not a DPI guess: the template canvas is ~1688px wide
        // for an 85.6mm CR80 card, which is ~500dpi. "5.63in" here used to
        // assume 300dpi (1688/300), rendering the card at 1.67x its real size —
        // on an actual 85.6mm-wide printer that clipped everything past the
        // top-left ~60%, including any field placed in the lower portion of
        // the canvas.
        width: previewMode ? "min(100%, 640px)" : `${CARD_WIDTH_MM}mm`,
        aspectRatio: `${canvasW} / ${canvasH}`,
        // Field font-size below is set in cqh (container query height) so it
        // scales with the card rather than a fixed rem value. cqh needs a
        // sized containment context on an ancestor or it silently falls back
        // to the viewport's height, which has nothing to do with this card.
        containerType: "size",
        // The uploaded, super-admin-activated template artwork is what actually
        // prints. The gradient is only a placeholder for a woreda that hasn't
        // set one yet — printing that as-is would ship a blank card.
        background: bgUrl
          ? `url(${bgUrl}) center/cover no-repeat`
          : "linear-gradient(135deg,#eff6ff,#dbeafe 60%,#bfdbfe)",
        fontFamily: "'Noto Sans Ethiopic','Inter',system-ui,sans-serif",
        overflow: "hidden",
      }}
    >
      {fields
        .slice()
        .sort((a, b) => a.z_index - b.z_index)
        .map((f) => {
          const common: React.CSSProperties = {
            position: "absolute",
            left: `${(Number(f.x) / canvasW) * 100}%`,
            top: `${(Number(f.y) / canvasH) * 100}%`,
            width: `${(Number(f.width) / canvasW) * 100}%`,
            height: `${(Number(f.height) / canvasH) * 100}%`,
          };
          if (f.field_key === "barcode") {
            // This is the surface that actually prints, so the density check
            // has to run against the field's real millimetre width on the card,
            // not the pixels it happens to occupy on screen.
            const widthMm = (Number(f.width) / canvasW) * CARD_WIDTH_MM;
            return (
              <div key={f.field_key} style={{ ...common, background: "#fff" }}>
                <CredentialBarcode
                  credentialNumber={credentialNumber}
                  widthMm={widthMm}
                  fill
                  showValue={false}
                />
              </div>
            );
          }
          if (f.field_key === "photo") {
            return (
              <div
                key={f.field_key}
                style={{ ...common, background: "#e2e8f0", overflow: "hidden" }}
              >
                {photoUrl && (
                  <img
                    src={photoUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                )}
              </div>
            );
          }
          if (f.field_key === "qr_code") {
            // f.width/f.height are canvas-design units, not CSS pixels — the
            // container itself is now sized to the card's true physical width
            // (see PrintableCard), so the QR has to be computed in the same
            // physical units or it re-creates the same oversize-and-clip bug
            // that "5.63in" caused for the whole card.
            const mmPerCanvasUnit = CARD_WIDTH_MM / canvasW;
            const fieldWidthMm = Number(f.width) * mmPerCanvasUnit;
            const fieldHeightMm = Number(f.height) * mmPerCanvasUnit;
            const qrSizePx = mmToPx(Math.min(fieldWidthMm, fieldHeightMm) * 0.9);
            return (
              <div
                key={f.field_key}
                style={{
                  ...common,
                  background: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isSignedToken(qrPayload) ? (
                  <QRBoundary size={qrSizePx}>
                    <QRCodeCanvas
                      value={credentialVerifyUrl(qrPayload)}
                      size={qrSizePx}
                      level="L"
                    />
                  </QRBoundary>
                ) : null}
              </div>
            );
          }
          const value = values[f.field_key] ?? "";
          return (
            <div
              key={f.field_key}
              style={{
                ...common,
                display: "flex",
                alignItems: "center",
                justifyContent:
                  f.text_align === "center"
                    ? "center"
                    : f.text_align === "right"
                      ? "flex-end"
                      : "flex-start",
                fontSize: f.font_size ? `${(Number(f.font_size) / canvasH) * 100}cqh` : "1rem",
                fontWeight: f.font_weight === "bold" ? 700 : 400,
                color: "#0f172a",
                padding: "0 0.25%",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {value}
            </div>
          );
        })}
    </div>
  );
}

function ErrorPanel({
  titleAm,
  titleEn,
  message,
  hint,
  onBack,
}: {
  titleAm: string;
  titleEn: string;
  message: string;
  hint?: string;
  onBack: () => void;
}) {
  return (
    <div className="p-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="font-noto-ethiopic font-semibold text-red-900">{titleAm}</p>
        <p className="text-sm font-medium text-red-800">{titleEn}</p>
        <p className="mt-2 text-sm text-red-700">{message}</p>
        {hint && <p className="mt-1 text-xs text-red-600">{hint}</p>}
        <Button variant="outline" className="mt-4" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    </div>
  );
}
