import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Building2,
  Image as ImageIcon,
  Hash,
  Banknote,
  Save,
  Upload,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { PermissionGate } from "@/components/common/PermissionGate";
import { StatusChip } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { P } from "@/config/permissions";
import { useAuthStore } from "@/stores/authStore";
import { useWoredaInfo } from "@/hooks/useWoredaInfo";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toWebp, storageExtension, BRANDING_WEBP } from "@/utils/imageCompression";
import { LetterTemplatesTab } from "@/components/settings/LetterTemplatesTab";

export const Route = createFileRoute("/woreda/settings/woreda-configuration")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.TENANT_MANAGE}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to manage settings.</p>
        </div>
      }
    >
      <SettingsPage />
    </PermissionGate>
  ),
});

/* ---------- Profile / Numbering form schema ---------- */

const profileSchema = z.object({
  woreda_name_display: z.string().trim().max(200).optional().or(z.literal("")),
  woreda_name_display_en: z.string().trim().max(200).optional().or(z.literal("")),
  woreda_name_display_har: z.string().trim().max(200).optional().or(z.literal("")),
  woreda_name_display_om: z.string().trim().max(200).optional().or(z.literal("")),
  contact_phone: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{9}$/.test(v), "Phone must be 9 digits after +251"),
  contact_email: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, "Invalid email"),
  address_line: z.string().trim().max(500).optional().or(z.literal("")),
  resident_number_format: z
    .string()
    .trim()
    .min(1, "Required")
    .refine((v) => v.includes("{WOREDA_CODE}"), "Must include {WOREDA_CODE}")
    .refine((v) => /\{SEQ:\d+\}/.test(v) || v.includes("{SEQ}"), "Must include {SEQ:N} or {SEQ}"),
  logo_url: z.string().optional().or(z.literal("")),
  stamp_url: z.string().optional().or(z.literal("")),
  supervisor_signature_url: z.string().optional().or(z.literal("")),
});
type ProfileForm = z.infer<typeof profileSchema>;

/* ---------- Utilities ---------- */

function stripPhonePrefix(v: string | null | undefined): string {
  if (!v) return "";
  return v.replace(/^\+251/, "").replace(/\D/g, "");
}

function previewResidentNumber(format: string, woredaCode: string): string {
  if (!format) return "";
  let out = format.replace(/\{WOREDA_CODE\}/g, woredaCode || "CODE");
  const m = out.match(/\{SEQ:(\d+)\}/);
  if (m) {
    const width = parseInt(m[1], 10);
    out = out.replace(/\{SEQ:\d+\}/g, "1".padStart(width, "0"));
  } else {
    out = out.replace(/\{SEQ\}/g, "1");
  }
  return out;
}

/* ---------- Page ---------- */

function SettingsPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const userId = useAuthStore((s) => s.user?.id);
  const { data: woreda } = useWoredaInfo();
  const qc = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["woreda_settings", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda_settings")
        .select("*")
        .eq("woreda_id", woredaId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const feesQuery = useQuery({
    queryKey: ["fee_schedule", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_schedule")
        .select("*")
        .eq("woreda_id", woredaId as string)
        .order("service_type");
      if (error) throw error;
      return data ?? [];
    },
  });

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      woreda_name_display: "",
      woreda_name_display_en: "",
      woreda_name_display_har: "",
      woreda_name_display_om: "",
      contact_phone: "",
      contact_email: "",
      address_line: "",
      resident_number_format: "{WOREDA_CODE}-{SEQ:6}",
      logo_url: "",
      stamp_url: "",
      supervisor_signature_url: "",
    },
  });

  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    form.reset({
      woreda_name_display: s.woreda_name_display ?? "",
      woreda_name_display_en: s.woreda_name_display_en ?? "",
      woreda_name_display_har: s.woreda_name_display_har ?? "",
      woreda_name_display_om: s.woreda_name_display_om ?? "",
      contact_phone: stripPhonePrefix(s.contact_phone),
      contact_email: s.contact_email ?? "",
      address_line: s.address_line ?? "",
      resident_number_format: s.resident_number_format ?? "{WOREDA_CODE}-{SEQ:6}",
      logo_url: s.logo_url ?? "",
      stamp_url: s.stamp_url ?? "",
      supervisor_signature_url: s.supervisor_signature_url ?? "",
    });
  }, [settingsQuery.data, form]);

  const [saving, setSaving] = useState(false);

  const onSave = form.handleSubmit(async (values) => {
    if (!woredaId) return;
    setSaving(true);
    try {
      const payload: Database["public"]["Tables"]["woreda_settings"]["Insert"] = {
        woreda_id: woredaId,
        woreda_name_display: values.woreda_name_display || null,
        woreda_name_display_en: values.woreda_name_display_en || null,
        woreda_name_display_har: values.woreda_name_display_har || null,
        woreda_name_display_om: values.woreda_name_display_om || null,
        contact_phone: values.contact_phone ? `+251${values.contact_phone}` : null,
        contact_email: values.contact_email || null,
        address_line: values.address_line || null,
        resident_number_format: values.resident_number_format,
        logo_url: values.logo_url || null,
        stamp_url: values.stamp_url || null,
        supervisor_signature_url: values.supervisor_signature_url || null,
        updated_by: userId ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("woreda_settings")
        .upsert(payload, { onConflict: "woreda_id" });
      if (error) throw error;

      // woreda_id was previously omitted here -- audit_log_tenant_insert's
      // WITH CHECK is `woreda_id = get_user_woreda_id()`, and NULL = uuid
      // evaluates to NULL (not true), so the row was silently rejected by
      // RLS on every save (the error was never checked). No settings save
      // has ever produced an audit trail, including this one now covering
      // the two new language fields.
      const { error: auditError } = await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: userId ?? null,
        entity_name: "woreda_settings",
        entity_id: woredaId,
        action_type: "SETTINGS_UPDATED",
        new_value_json: payload as never,
      });
      if (auditError) throw auditError;

      toast.success("ቅንብሮች ተስተካክለዋል / Settings saved");
      qc.invalidateQueries({ queryKey: ["woreda_settings", woredaId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  });

  const residentFormat = form.watch("resident_number_format");
  const woredaCode = woreda?.woreda_code ?? "";

  return (
    <div className="pb-32">
      <PageHeader
        icon={Building2}
        titleAm="የወረዳ ውቅር"
        titleEn="Woreda Configuration"
        description="የወረዳ መገለጫ፣ ምስሎች፣ ቅርጸቶች እና ክፍያዎች / Woreda profile, images, numbering formats & fees"
      />

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-slate-200 bg-transparent p-0">
          <SettingsTab value="profile" labelAm="ወረዳ መረጃ" labelEn="Woreda Profile" />
          <SettingsTab value="images" labelAm="የምስል ሰነዶች" labelEn="Official Images" />
          <SettingsTab value="numbering" labelAm="የቁጥር ቅርጸቶች" labelEn="Numbering Formats" />
          <SettingsTab value="fees" labelAm="ክፍያ" labelEn="Fees" />
          <SettingsTab value="letters" labelAm="የደብዳቤ አብነቶች" labelEn="Letter Templates" />
        </TabsList>

        {/* -------- TAB 1: Profile -------- */}
        <TabsContent value="profile" className="mt-6 space-y-6">
          <Card className="p-6">
            <SectionTitle titleAm="መሰረታዊ መረጃ" titleEn="General Info" />
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field labelAm="የወረዳ ስም (አማርኛ)" labelEn="Woreda Name (Amharic)">
                <Input
                  {...form.register("woreda_name_display")}
                  placeholder={woreda?.woreda_name_am ?? ""}
                />
              </Field>
              <Field labelAm="የወረዳ ስም (እንግሊዝኛ)" labelEn="Woreda Name (English)">
                <Input
                  {...form.register("woreda_name_display_en")}
                  placeholder={woreda?.woreda_name_en ?? ""}
                />
              </Field>
              <Field labelAm="የወረዳ ስም (ሐረሪ)" labelEn="Woreda Name (Harari)">
                <Input {...form.register("woreda_name_display_har")} />
              </Field>
              <Field labelAm="የወረዳ ስም (ኦሮምኛ)" labelEn="Woreda Name (Oromiffa)">
                <Input {...form.register("woreda_name_display_om")} />
              </Field>
              <p className="col-span-full text-xs text-slate-500">
                Shown as the issuing entity — including as "place of issue" on residence ID cards —
                instead of the official registry name below. Amharic/English: leave blank to use the
                registry name. Harari/Oromiffa have no registry equivalent to fall back to — leave
                blank and that field prints empty on the card.
              </p>
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle titleAm="አድራሻ እና ግንኙነት" titleEn="Contact" />
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                labelAm="ስልክ ቁጥር"
                labelEn="Phone"
                error={form.formState.errors.contact_phone?.message}
              >
                <div className="flex">
                  <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-slate-50 px-3 text-sm text-slate-600">
                    +251
                  </span>
                  <Input
                    className="rounded-l-none"
                    inputMode="numeric"
                    maxLength={9}
                    placeholder="9XXXXXXXX"
                    {...form.register("contact_phone")}
                  />
                </div>
              </Field>

              <Field
                labelAm="ኢሜይል"
                labelEn="Email"
                error={form.formState.errors.contact_email?.message}
              >
                <Input
                  type="email"
                  placeholder="office@example.gov.et"
                  {...form.register("contact_email")}
                />
              </Field>

              <Field labelAm="ጽህፈት ቤት አድራሻ" labelEn="Office Address" colSpan2>
                <Textarea rows={3} {...form.register("address_line")} />
              </Field>
            </div>
          </Card>
        </TabsContent>

        {/* -------- TAB 2: Images -------- */}
        <TabsContent value="images" className="mt-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            <ImageUploadCard
              titleAm="አርማ"
              titleEn="Logo"
              shape="circle"
              maxBytes={2 * 1024 * 1024}
              woredaId={woredaId}
              field="logo"
              currentPath={form.watch("logo_url")}
              onChange={(p) => form.setValue("logo_url", p, { shouldDirty: true })}
            />
            <ImageUploadCard
              titleAm="የወረዳ ማህተም"
              titleEn="Woreda Seal"
              shape="circle"
              maxBytes={1 * 1024 * 1024}
              woredaId={woredaId}
              field="stamp"
              currentPath={form.watch("stamp_url")}
              onChange={(p) => form.setValue("stamp_url", p, { shouldDirty: true })}
            />
            <ImageUploadCard
              titleAm="የፈራሚ ማህተም"
              titleEn="Signature Stamp"
              shape="square"
              maxBytes={1 * 1024 * 1024}
              helperAm="PNG ከነጭ ወይም ግልጽ ጀርባ ይቅናል"
              helperEn="PNG with white or transparent background preferred"
              woredaId={woredaId}
              field="signature"
              currentPath={form.watch("supervisor_signature_url")}
              onChange={(p) => form.setValue("supervisor_signature_url", p, { shouldDirty: true })}
            />
          </div>
        </TabsContent>

        {/* -------- TAB 3: Numbering -------- */}
        <TabsContent value="numbering" className="mt-6 space-y-4">
          <Card className="p-6">
            <SectionTitle titleAm="የነዋሪ ቁጥር ቅርጸት" titleEn="Resident Number Format" />
            <div className="mt-4 space-y-3">
              <Input
                {...form.register("resident_number_format")}
                placeholder="{WOREDA_CODE}-{SEQ:6}"
              />
              {form.formState.errors.resident_number_format && (
                <p className="text-xs text-red-600">
                  {form.formState.errors.resident_number_format.message}
                </p>
              )}
              <p className="text-xs text-slate-500">
                Tokens: <code className="rounded bg-slate-100 px-1">{"{WOREDA_CODE}"}</code>{" "}
                <code className="rounded bg-slate-100 px-1">{"{SEQ:N}"}</code>
              </p>
              <PreviewLine
                label="Preview"
                value={previewResidentNumber(residentFormat, woredaCode)}
              />
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle titleAm="የኩነት ቁጥር ቅርጸት" titleEn="Civil Event Number Format" />
            <div className="mt-4 space-y-3">
              <ReadOnlyBox value="{WOREDA_CODE}-{TYPE}-{YY}-{SEQ:6}" />
              <PreviewLine label="Example" value={`${woredaCode || "ABOKER"}-BR-26-000001`} />
              <p className="font-noto-ethiopic text-xs text-slate-500">
                ይህ ቅርጸት በስርዓቱ ተስተካክሏል፤ ለውጥ አያስፈልገውም / This format is system-managed and does not
                need adjustment.
              </p>
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle titleAm="የደረሰኝ ቁጥር ቅርጸት" titleEn="Receipt Number Format" />
            <div className="mt-4 space-y-3">
              <ReadOnlyBox value="{WOREDA_CODE}-RCT-{YY}-{SEQ:6}" />
              <PreviewLine label="Example" value={`${woredaCode || "ABOKER"}-RCT-26-000001`} />
              <p className="font-noto-ethiopic text-xs text-slate-500">
                ይህ ቅርጸት በስርዓቱ ተስተካክሏል፤ ለውጥ አያስፈልገውም / System-managed format.
              </p>
            </div>
          </Card>
        </TabsContent>

        {/* -------- TAB 4: Fees -------- */}
        <TabsContent value="fees" className="mt-6">
          <FeesTab
            woredaId={woredaId}
            rows={feesQuery.data ?? []}
            loading={feesQuery.isLoading}
            onChanged={() => qc.invalidateQueries({ queryKey: ["fee_schedule", woredaId] })}
          />
        </TabsContent>

        <TabsContent value="letters" className="mt-6">
          <LetterTemplatesTab />
        </TabsContent>
      </Tabs>

      {/* Sticky footer (Tabs 1-3) */}
      <div className="fixed bottom-0 left-64 right-0 z-20 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-end gap-3">
          {form.formState.isDirty && (
            <span className="font-noto-ethiopic text-xs text-amber-600">
              ያልተቀመጡ ለውጦች አሉ / You have unsaved changes
            </span>
          )}
          <Button
            onClick={onSave}
            disabled={saving || !form.formState.isDirty}
            className="bg-blue-700 hover:bg-blue-800"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            <span className="font-noto-ethiopic">ለውጦችን አስቀምጥ</span>
            <span className="ml-1 text-xs opacity-80">/ Save Changes</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function SettingsTab({
  value,
  labelAm,
  labelEn,
}: {
  value: string;
  labelAm: string;
  labelEn: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="relative rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-slate-600 shadow-none data-[state=active]:border-blue-700 data-[state=active]:bg-transparent data-[state=active]:text-blue-800 data-[state=active]:shadow-none"
    >
      <div className="flex flex-col items-start leading-tight">
        <span className="font-noto-ethiopic text-sm font-medium">{labelAm}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{labelEn}</span>
      </div>
    </TabsTrigger>
  );
}

function SectionTitle({ titleAm, titleEn }: { titleAm: string; titleEn: string }) {
  return (
    <div className="border-b border-slate-100 pb-3">
      <h3 className="font-noto-ethiopic text-base font-semibold text-slate-900">{titleAm}</h3>
      <p className="text-xs text-slate-500">{titleEn}</p>
    </div>
  );
}

function Field({
  labelAm,
  labelEn,
  colSpan2,
  error,
  children,
}: {
  labelAm: string;
  labelEn: string;
  colSpan2?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={colSpan2 ? "md:col-span-2" : ""}>
      <Label className="mb-1.5 block">
        <span className="font-noto-ethiopic text-sm font-medium text-slate-700">{labelAm}</span>
        <span className="ml-1 text-xs text-slate-500">/ {labelEn}</span>
      </Label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReadOnlyBox({ value }: { value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">
      {value}
    </div>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">{label}:</span>
      <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-blue-800">{value}</span>
    </div>
  );
}

/* ---------- Image upload card ---------- */

function ImageUploadCard({
  titleAm,
  titleEn,
  shape,
  maxBytes,
  helperAm,
  helperEn,
  woredaId,
  field,
  currentPath,
  onChange,
}: {
  titleAm: string;
  titleEn: string;
  shape: "circle" | "square";
  maxBytes: number;
  helperAm?: string;
  helperEn?: string;
  woredaId: string | null;
  field: "logo" | "stamp" | "signature";
  currentPath: string | undefined;
  onChange: (path: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!currentPath) {
        setSignedUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from("tenant-assets")
        .createSignedUrl(currentPath, 3600);
      if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  async function onFile(file: File) {
    if (!woredaId) return;
    if (!/^image\/(png|jpeg|jpg)$/.test(file.type)) {
      toast.error("Only PNG or JPEG allowed");
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`File too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)`);
      return;
    }
    setUploading(true);
    try {
      // High quality: these end up on printed letterheads and ID cards. WebP
      // keeps the alpha channel, so cut-out logos and signatures stay
      // transparent where a JPEG would have flattened them onto black.
      const upload = await toWebp(file, BRANDING_WEBP);
      const path = `${woredaId}/${field}.${storageExtension(upload, "png")}`;
      const { error } = await supabase.storage
        .from("tenant-assets")
        .upload(path, upload, { upsert: true, contentType: upload.type });
      if (error) throw error;
      onChange(path);
      toast.success("Uploaded — remember to save");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3">
        <h3 className="font-noto-ethiopic text-sm font-semibold text-slate-900">{titleAm}</h3>
        <p className="text-xs text-slate-500">{titleEn}</p>
      </div>

      <label className="group flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 transition hover:border-blue-400 hover:bg-blue-50/40">
        {signedUrl ? (
          <img
            src={signedUrl}
            alt={titleEn}
            className={`h-32 w-32 object-cover ${shape === "circle" ? "rounded-full" : "rounded-md"} ring-2 ring-white shadow-sm`}
          />
        ) : (
          <div
            className={`flex h-32 w-32 items-center justify-center bg-white text-slate-300 ${shape === "circle" ? "rounded-full" : "rounded-md"} border border-slate-200`}
          >
            <ImageIcon className="h-10 w-10" />
          </div>
        )}
        <div className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-700">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          <span className="font-noto-ethiopic">ምስል አዘምን</span>
          <span className="text-xs text-slate-500">/ Update Image</span>
        </div>
        <input
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </label>

      {(helperAm || helperEn) && (
        <p className="mt-3 text-xs text-slate-500">
          {helperAm && <span className="font-noto-ethiopic">{helperAm}</span>}
          {helperAm && helperEn && " / "}
          {helperEn}
        </p>
      )}
      <p className="mt-1 text-[11px] text-slate-400">
        Max {Math.round(maxBytes / 1024 / 1024)}MB · PNG / JPEG
      </p>
    </Card>
  );
}

/* ---------- Fees tab ---------- */

interface FeeRow {
  fee_schedule_id: string;
  woreda_id: string;
  service_type: string;
  standard_fee: number | string;
  penalty_rate: number | string;
  status: string;
}

function FeesTab({
  woredaId,
  rows,
  loading,
  onChanged,
}: {
  woredaId: string | null;
  rows: FeeRow[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<FeeRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="font-noto-ethiopic text-base font-semibold text-slate-900">
            የአገልግሎት ክፍያዎች
          </h3>
          <p className="text-xs text-slate-500">Service Fees</p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          className="bg-blue-700 hover:bg-blue-800"
          size="sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          <span className="font-noto-ethiopic">አዲስ የአገልግሎት ክፍያ</span>
          <span className="ml-1 text-xs opacity-80">/ New Service Fee</span>
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">
                <span className="font-noto-ethiopic">የአገልግሎት ዓይነት</span> / Service Type
              </th>
              <th className="px-5 py-3">
                <span className="font-noto-ethiopic">መደበኛ ክፍያ</span> / Standard Fee
              </th>
              <th className="px-5 py-3">
                <span className="font-noto-ethiopic">የቅጣት መጠን</span> / Penalty
              </th>
              <th className="px-5 py-3">
                <span className="font-noto-ethiopic">ሁኔታ</span> / Status
              </th>
              <th className="px-5 py-3 text-right">
                <span className="font-noto-ethiopic">ድርጊት</span> / Action
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                  No fees configured yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.fee_schedule_id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.service_type}</td>
                  <td className="px-5 py-3 text-slate-700">
                    ETB {Number(r.standard_fee).toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-slate-700">
                    ETB {Number(r.penalty_rate).toFixed(2)}
                  </td>
                  <td className="px-5 py-3">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(r)}
                      className="text-blue-700"
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      <span className="font-noto-ethiopic">አርትዕ</span>
                      <span className="ml-1 text-xs opacity-70">/ EDIT</span>
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <FeeDialog
          initial={editing}
          woredaId={woredaId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {creating && (
        <FeeDialog
          initial={null}
          woredaId={woredaId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

/* ---------- Fee dialog ---------- */

const feeSchema = z.object({
  service_type: z.string().trim().min(1, "Required"),
  standard_fee: z.coerce.number().min(0),
  penalty_rate: z.coerce.number().min(0),
  status: z.enum(["active", "review_required", "inactive"]),
});
type FeeForm = z.infer<typeof feeSchema>;

function FeeDialog({
  initial,
  woredaId,
  onClose,
  onSaved,
}: {
  initial: FeeRow | null;
  woredaId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [saving, setSaving] = useState(false);
  const form = useForm<FeeForm>({
    resolver: zodResolver(feeSchema),
    defaultValues: {
      service_type: initial?.service_type ?? "",
      standard_fee: Number(initial?.standard_fee ?? 0),
      penalty_rate: Number(initial?.penalty_rate ?? 0),
      status: (initial?.status as FeeForm["status"]) ?? "active",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!woredaId) return;
    setSaving(true);
    try {
      if (isEdit && initial) {
        const { error } = await supabase
          .from("fee_schedule")
          .update({
            standard_fee: values.standard_fee,
            penalty_rate: values.penalty_rate,
            status: values.status,
            service_type: values.service_type,
          })
          .eq("fee_schedule_id", initial.fee_schedule_id);
        if (error) throw error;
        await supabase.from("audit_log").insert({
          entity_name: "fee_schedule",
          entity_id: initial.fee_schedule_id,
          action_type: "FEE_SCHEDULE_UPDATED",
          new_value_json: values as never,
        });
      } else {
        const { data, error } = await supabase
          .from("fee_schedule")
          .insert({ ...values, woreda_id: woredaId })
          .select("fee_schedule_id")
          .single();
        if (error) throw error;
        await supabase.from("audit_log").insert({
          entity_name: "fee_schedule",
          entity_id: data.fee_schedule_id,
          action_type: "FEE_SCHEDULE_UPDATED",
          new_value_json: values as never,
        });
      }
      toast.success("ክፍያው ተስተካክሏል / Fee updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  });

  const statuses: FeeForm["status"][] = ["active", "review_required", "inactive"];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">{isEdit ? "የክፍያ አርትዕ" : "አዲስ ክፍያ"}</span>
            <span className="ml-2 text-sm font-normal text-slate-500">
              / {isEdit ? "Edit Fee" : "New Fee"}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field
            labelAm="የአገልግሎት ዓይነት"
            labelEn="Service Type"
            error={form.formState.errors.service_type?.message}
          >
            <Input {...form.register("service_type")} disabled={isEdit} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              labelAm="መደበኛ ክፍያ (ETB)"
              labelEn="Standard Fee"
              error={form.formState.errors.standard_fee?.message}
            >
              <Input type="number" step="0.01" min="0" {...form.register("standard_fee")} />
            </Field>
            <Field
              labelAm="የቅጣት መጠን (ETB)"
              labelEn="Penalty"
              error={form.formState.errors.penalty_rate?.message}
            >
              <Input type="number" step="0.01" min="0" {...form.register("penalty_rate")} />
            </Field>
          </div>
          <Field labelAm="ሁኔታ" labelEn="Status">
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={saving} className="bg-blue-700 hover:bg-blue-800">
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
