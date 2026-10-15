/**
 * "Certificate details" card on a civil event: captures every field the
 * printed certificate needs (bilingual names, places, nationality, dates,
 * form and ID numbers) into vital_event.event_details.certificate, prefilled
 * from the event's own data and its linked residents. Frozen once the event
 * is registered (trigger trg_pin_vital_event_certificate, migration 101);
 * from then on the card offers the certificate print instead.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileBadge, Loader2, Printer, Save, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EthiopianDateInput } from "@/components/common/EthiopianDateInput";
import {
  CERTIFICATE_TYPE_LABELS,
  FIELD_GROUPS,
  inputFields,
  type CertificateField,
  type CertificateType,
} from "@/config/certificateFields";
import { P } from "@/config/permissions";
import {
  certificateInputOf,
  certificatePrefill,
  inputKeysOf,
  isCertificateType,
  type CertificateEventRow,
  type CertificateInput,
  type LinkedResident,
} from "@/lib/certificateData";
import { ROW_VERIFICATION_FAILURE_MESSAGE } from "@/lib/rowVerification";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

const EDIT_PERMS = [P.CIVIL_REGISTER, P.CIVIL_CREATE_EVENT, P.CIVIL_VERIFY, P.CIVIL_RESUBMIT];
const FROZEN = new Set(["registered", "issued", "rejected"]);
const RESIDENT_COLS =
  "resident_id, first_name, father_name, grandfather_name, full_name, full_name_am, sex, date_of_birth, birth_place, mother_full_name";

interface Props {
  eventId: string;
  woredaId: string;
  status: string;
  event: CertificateEventRow & { resident_id: string | null };
}

export function CertificateDetailsCard({ eventId, woredaId, status, event }: Props) {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const type = event.event_type;
  const canEdit = EDIT_PERMS.some((p) => hasPermission(p)) && !FROZEN.has(status);
  const saved = useMemo(() => certificateInputOf(event), [event]);
  const [values, setValues] = useState<CertificateInput>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValues(saved), [saved]);

  const details = (event.event_details ?? {}) as Record<string, { resident_id?: string } | unknown>;
  const spouseId = (k: string) => {
    const v = details[k];
    return v && typeof v === "object"
      ? ((v as { resident_id?: string }).resident_id ?? null)
      : null;
  };
  const linkIds = {
    subject: event.resident_id,
    party1: spouseId("spouse1"),
    party2: spouseId("spouse2"),
  };
  const ids = Object.values(linkIds).filter((v): v is string => !!v);

  const residentsQuery = useQuery({
    queryKey: ["certificate-linked-residents", eventId, ids.join(",")],
    enabled: ids.length > 0 && canEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select(RESIDENT_COLS as "*")
        .in("resident_id", ids);
      if (error) throw error;
      return (data ?? []) as unknown as (LinkedResident & { resident_id: string })[];
    },
  });

  const templateQuery = useQuery({
    queryKey: ["certificate-template-published", type],
    enabled: isCertificateType(type),
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          from: (t: string) => any;
        }
      )
        .from("certificate_template")
        .select("published_at")
        .eq("certificate_type", type)
        .maybeSingle();
      if (error) throw error;
      return data as { published_at: string | null } | null;
    },
  });

  if (!isCertificateType(type)) return null;
  const certType: CertificateType = type;
  const fields = inputFields(certType);
  const filled = fields.filter((f) => inputKeysOf(f).some((k) => (values[k] ?? "").trim())).length;
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const label = CERTIFICATE_TYPE_LABELS[certType];
  // Print (registered -> issued) or reprint (issued), as in the ID card flow;
  // record_civil_certificate_print() enforces the same rules server-side.
  const published = !!templateQuery.data?.published_at;
  const canPrint =
    published &&
    ((status === "registered" && hasPermission(P.CIVIL_PRINT_CERTIFICATE)) ||
      (status === "issued" &&
        (hasPermission(P.CIVIL_AUTHORIZE_REPRINT) || hasPermission(P.CIVIL_READ))));

  const prefill = () => {
    const byId = new Map((residentsQuery.data ?? []).map((r) => [r.resident_id, r]));
    const seed = certificatePrefill(
      certType,
      { ...event, event_details: { ...details, certificate: values } },
      {
        subject: linkIds.subject ? byId.get(linkIds.subject) : null,
        party1: linkIds.party1 ? byId.get(linkIds.party1) : null,
        party2: linkIds.party2 ? byId.get(linkIds.party2) : null,
      },
    );
    const n = Object.keys(seed).length;
    if (!n) return toast.info("ከመዝገብ የሚሞላ አዲስ መረጃ የለም / Nothing new to prefill from the records");
    setValues((v) => ({ ...v, ...seed }));
    toast.success(`${n} መስኮች ተሞልተዋል / ${n} fields prefilled — review and save`);
  };

  const save = async () => {
    setSaving(true);
    try {
      const clean: CertificateInput = {};
      for (const [k, v] of Object.entries(values)) {
        const t = (v ?? "").trim();
        if (t) clean[k] = t.slice(0, 300);
      }
      const { data, error } = await supabase
        .from("vital_event")
        .update({ event_details: { ...details, certificate: clean } as never })
        .eq("vital_event_id", eventId)
        .eq("woreda_id", woredaId)
        .select("vital_event_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(ROW_VERIFICATION_FAILURE_MESSAGE);
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        entity_name: "vital_event",
        entity_id: eventId,
        action_type: "CERTIFICATE_DETAILS_SAVED",
        new_value_json: { fields: Object.keys(clean).length } as never,
      });
      toast.success("የምስክር ወረቀት መረጃ ተቀምጧል / Certificate details saved");
      qc.invalidateQueries({ queryKey: ["vital-event", eventId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string, v: string) => setValues((cur) => ({ ...cur, [k]: v }));

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <FileBadge className="h-5 w-5 text-blue-700" />
        <div className="mr-auto">
          <h2 className="font-am-heading text-base font-semibold text-slate-900">
            የምስክር ወረቀት መረጃ — {label.am}
          </h2>
          <p className="text-xs text-slate-500">
            Certificate details — {label.en} · {filled} / {fields.length}
          </p>
        </div>
        {canEdit && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={prefill}
              disabled={residentsQuery.isLoading}
            >
              <Wand2 className="mr-1 h-4 w-4" />
              <span className="font-am-body">ከመዝገብ ሙላ</span>
              <span className="ml-1 opacity-80">/ Prefill</span>
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              <span className="font-am-body">አስቀምጥ</span>
              <span className="ml-1 opacity-80">/ Save</span>
            </Button>
          </>
        )}
        {canPrint && (
          <Link to="/woreda/civil/$eventId/certificate" params={{ eventId }}>
            <Button size="sm" className="bg-[color:var(--color-shell-header)] text-white">
              <Printer className="mr-1 h-4 w-4" />
              <span className="font-am-body">
                {status === "issued" ? "የምስክር ወረቀት" : "የምስክር ወረቀት አትምና ስጥ"}
              </span>
              <span className="ml-1 opacity-80">
                / {status === "issued" ? "Certificate" : "Print & issue certificate"}
              </span>
            </Button>
          </Link>
        )}
      </header>

      {(status === "registered" || status === "issued") && !templateQuery.data?.published_at && (
        <p className="font-am-body mx-4 mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ለዚህ የምስክር ወረቀት የታተመ አብነት የለም።
          <span className="ml-1">
            / No published template for this certificate yet — a platform administrator must publish
            one in the console.
          </span>
        </p>
      )}

      <div className="space-y-4 p-4">
        {FIELD_GROUPS.map((g) => {
          const items = fields.filter((f) => f.group === g.key);
          if (!items.length) return null;
          return (
            <fieldset key={g.key}>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span className="font-am-body normal-case">{g.am}</span> / {g.en}
              </legend>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    values={values}
                    disabled={!canEdit}
                    onChange={set}
                  />
                ))}
              </div>
            </fieldset>
          );
        })}
        {!canEdit && FROZEN.has(status) && (
          <p className="font-am-body text-xs text-slate-500">
            ኩነቱ ከተመዘገበ በኋላ መረጃው አይቀየርም።
            <span className="ml-1">/ Details are locked once the event is registered.</span>
          </p>
        )}
      </div>
    </section>
  );
}

function FieldInput({
  field,
  values,
  disabled,
  onChange,
}: {
  field: CertificateField;
  values: CertificateInput;
  disabled: boolean;
  onChange: (k: string, v: string) => void;
}) {
  const label = (
    <span className="block text-xs text-slate-600">
      <span className="font-am-body">{field.am}</span> / {field.en}
    </span>
  );
  if (field.kind === "bilingual") {
    return (
      <div>
        {label}
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Input
            aria-label={`${field.en} (Amharic)`}
            className="font-am-body"
            placeholder="አማርኛ"
            maxLength={300}
            disabled={disabled}
            value={values[`${field.key}_am`] ?? ""}
            onChange={(e) => onChange(`${field.key}_am`, e.target.value)}
          />
          <Input
            aria-label={`${field.en} (English)`}
            placeholder="English"
            maxLength={300}
            disabled={disabled}
            value={values[`${field.key}_en`] ?? ""}
            onChange={(e) => onChange(`${field.key}_en`, e.target.value)}
          />
        </div>
      </div>
    );
  }
  if (field.kind === "date") {
    return (
      <div>
        {label}
        <div className="mt-1">
          <EthiopianDateInput
            value={values[field.key] ?? ""}
            onChange={(iso) => onChange(field.key, iso)}
            disabled={disabled}
          />
        </div>
      </div>
    );
  }
  if (field.kind === "sex") {
    return (
      <label className="block">
        {label}
        <select
          className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm disabled:bg-slate-50"
          disabled={disabled}
          value={values[field.key] ?? ""}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          <option value="">—</option>
          <option value="male">ወንድ / Male</option>
          <option value="female">ሴት / Female</option>
        </select>
      </label>
    );
  }
  return (
    <label className="block">
      {label}
      <Input
        className="mt-1"
        maxLength={120}
        disabled={disabled}
        value={values[field.key] ?? ""}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    </label>
  );
}
