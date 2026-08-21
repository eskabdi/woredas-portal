import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Shield, ChevronLeft, ChevronRight, Check, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/PageHeader";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/tenants/$woredaId/provision")({
  ssr: false,
  component: ProvisionPage,
});

const MODULES = [
  { key: "credentials", am: "የመኖሪያ መታወቂያ", en: "Credentials" },
  { key: "civil_registration", am: "የኩነት ምዝገባ", en: "Civil Registration" },
  { key: "revenue", am: "ገቢ", en: "Revenue" },
  { key: "reports", am: "ሪፖርቶች", en: "Reports" },
  { key: "audit", am: "ኦዲት", en: "Audit Trail" },
] as const;

const STEPS = [
  { n: 1, am: "ወረዳ ማረጋገጫ", en: "Confirm Woreda" },
  { n: 2, am: "የሞጁል ውቅር", en: "Modules" },
  { n: 3, am: "የአስተዳዳሪ መለያ", en: "Administrator" },
  { n: 4, am: "ግምገማ", en: "Review" },
];

function ProvisionPage() {
  const { woredaId } = Route.useParams();
  const navigate = useNavigate();

  const { data: woreda } = useQuery({
    queryKey: ["provision-woreda", woredaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda")
        .select("woreda_id, woreda_code, woreda_numeric_code, woreda_name_am, woreda_name_en")
        .eq("woreda_id", woredaId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: existingAdmin } = useQuery({
    queryKey: ["provision-existing", woredaId],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_user")
        .select("full_name, status")
        .eq("woreda_id", woredaId)
        .eq("role", "tenant_admin")
        .neq("status", "suspended")
        .maybeSingle();
      return data;
    },
  });

  const { data: currentModules = [] } = useQuery({
    queryKey: ["provision-modules", woredaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_module_config")
        .select("module_key, is_enabled")
        .eq("woreda_id", woredaId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [step, setStep] = useState(1);
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Initialize modules from DB once
  if (Object.keys(modules).length === 0 && currentModules.length > 0) {
    const init: Record<string, boolean> = {};
    for (const m of MODULES) init[m.key] = true;
    for (const row of currentModules) init[row.module_key] = row.is_enabled;
    setModules(init);
  } else if (Object.keys(modules).length === 0 && woreda) {
    const init: Record<string, boolean> = {};
    for (const m of MODULES) init[m.key] = true;
    setModules(init);
  }

  const canNext = () => {
    if (step === 3) {
      if (!fullName.trim() || !email.trim()) return false;
      if (!/^\S+@\S+\.\S+$/.test(email)) return false;
    }
    return true;
  };

  function handlePhoneChange(v: string) {
    let digits = v.replace(/\D/g, "");
    if (digits.startsWith("251")) digits = digits.slice(3);
    if (digits.startsWith("0")) digits = digits.slice(1);
    digits = digits.slice(0, 9);
    setPhone(digits);
  }

  async function submit() {
    if (!woreda) return;
    setSubmitting(true);
    try {
      // 1. Upsert module config
      const rows = MODULES.map((m) => ({
        woreda_id: woredaId,
        module_key: m.key,
        is_enabled: modules[m.key] ?? true,
      }));
      const { error: modErr } = await supabase
        .from("tenant_module_config")
        .upsert(rows, { onConflict: "woreda_id,module_key" });
      if (modErr) throw modErr;

      // 2. Invoke invite function
      const { data, error } = await supabase.functions.invoke("invite-platform-admin", {
        body: {
          email: email.trim(),
          full_name: fullName.trim(),
          role: "tenant_admin",
          woredaId,
        },
      });
      const payload = data as { success?: boolean; warning?: string | null; error?: string } | null;
      if (error || payload?.error) {
        throw new Error(payload?.error ?? error?.message ?? "Failed to send invitation");
      }
      toast.success("ግብዣ ተልኳል / Invitation sent");
      if (payload?.warning) toast.warning(payload.warning);
      navigate({ to: "/admin/tenants" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!woreda) {
    return (
      <div className="p-6">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link to="/admin/tenants" className="text-sm text-blue-700 hover:underline">
          ← Back to Tenants
        </Link>
      </div>
      <PageHeader
        icon={Shield}
        titleAm="የወረዳ አስተዳዳሪ ማቅረብ"
        titleEn="Provision Tenant Administrator"
        description={`${woreda.woreda_name_am} / ${woreda.woreda_name_en}`}
      />

      {/* Stepper */}
      <div className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <div key={s.n} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  done
                    ? "bg-green-600 text-white"
                    : active
                      ? "bg-blue-700 text-white"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : s.n}
              </div>
              <div className="min-w-0">
                <div
                  className={`font-noto-ethiopic text-xs ${active ? "text-blue-700 font-semibold" : "text-slate-600"}`}
                >
                  {s.am}
                </div>
                <div className="text-[10px] text-slate-400">{s.en}</div>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 ${done ? "bg-green-600" : "bg-slate-200"}`} />
              )}
            </div>
          );
        })}
      </div>

      <Card className="p-6">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-noto-ethiopic text-lg font-semibold text-slate-900">
              ወረዳ ማረጋገጫ <span className="text-sm text-slate-500">/ Confirm Woreda</span>
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ReadRow
                am="የወረዳ ስም"
                en="Woreda Name"
                value={`${woreda.woreda_name_am} / ${woreda.woreda_name_en}`}
              />
              <ReadRow
                am="ኮድ"
                en="Numeric Code"
                value={String(woreda.woreda_numeric_code ?? woreda.woreda_code)}
              />
              <ReadRow am="ክልል" en="Region" value="ሐረሪ / Harari" />
              <ReadRow am="ሰዓት ዞን" en="Time Zone" value="East Africa Time (EAT)" />
            </div>
            {existingAdmin && (
              <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div className="text-sm">
                  <div className="font-noto-ethiopic font-medium text-amber-900">
                    ይህ ወረዳ ቀድሞውኑ አስተዳዳሪ አለው: {existingAdmin.full_name}
                  </div>
                  <div className="text-xs text-amber-700">
                    This woreda already has an administrator: {existingAdmin.full_name}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-noto-ethiopic text-lg font-semibold text-slate-900">
              የሞጁል ውቅር <span className="text-sm text-slate-500">/ Module Configuration</span>
            </h2>
            <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-900">
              <span className="font-noto-ethiopic">ነዋሪዎች፣ ቤተሰቦች፣ ዳሽቦርድ እና ቅንብሮች ሁልጊዜ ንቁ ናቸው</span>
              <span className="ml-1 text-blue-700">
                / Residents, Households, Dashboard, and Settings are always enabled.
              </span>
            </div>
            <div className="divide-y rounded-md border">
              {MODULES.map((m) => (
                <div key={m.key} className="flex items-center justify-between p-3">
                  <div>
                    <div className="font-noto-ethiopic text-sm font-medium">{m.am}</div>
                    <div className="text-xs text-slate-500">{m.en}</div>
                  </div>
                  <Switch
                    checked={modules[m.key] ?? true}
                    onCheckedChange={(c) => setModules((s) => ({ ...s, [m.key]: c }))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-noto-ethiopic text-lg font-semibold text-slate-900">
              የአስተዳዳሪ መለያ <span className="text-sm text-slate-500">/ Administrator Account</span>
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>Full Name / ሙሉ ስም *</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <Label>Government Email Address *</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>Phone Number</Label>
                <div className="flex">
                  <span className="inline-flex items-center rounded-l-md border border-r-0 bg-slate-50 px-3 text-sm text-slate-600">
                    +251
                  </span>
                  <Input
                    className="rounded-l-none"
                    value={phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="9XXXXXXXX"
                  />
                </div>
              </div>
            </div>
            <div className="rounded-md bg-blue-50 p-3 text-xs">
              <span className="font-noto-ethiopic text-blue-900">
                ወደዚህ አድራሻ የግብዣ ኢሜይል ይላካል። መለያው 'ወረዳ አስተዳዳሪ' ፈቃድ ይኖረዋል።
              </span>
              <div className="mt-1 text-blue-700">
                An invitation email will be sent to this address. The account will have 'Tenant
                Admin' privileges.
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="font-noto-ethiopic text-lg font-semibold text-slate-900">
              ግምገማ እና ማረጋገጫ <span className="text-sm text-slate-500">/ Review & Confirm</span>
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card className="p-4">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Woreda</div>
                <div className="font-noto-ethiopic text-slate-900">{woreda.woreda_name_am}</div>
                <div className="text-sm text-slate-600">
                  {woreda.woreda_name_en} · {woreda.woreda_numeric_code ?? woreda.woreda_code}
                </div>
              </Card>
              <Card className="p-4">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
                  Administrator
                </div>
                <div className="text-slate-900">{fullName}</div>
                <div className="text-sm text-slate-600">{email}</div>
                {phone && <div className="text-sm text-slate-600">+251{phone}</div>}
              </Card>
              <Card className="p-4 md:col-span-2">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Modules</div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {MODULES.map((m) => (
                    <div key={m.key} className="flex items-center gap-2 text-sm">
                      <span className={modules[m.key] ? "text-green-600" : "text-slate-400"}>
                        {modules[m.key] ? "●" : "○"}
                      </span>
                      <span className="font-noto-ethiopic">{m.am}</span>
                      <span className="text-xs text-slate-500">/ {m.en}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-between border-t pt-4">
          <Button
            variant="outline"
            disabled={step === 1 || submitting}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          {step < 4 ? (
            <Button
              disabled={!canNext()}
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              className="bg-blue-700 hover:bg-blue-800"
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button
              disabled={submitting}
              onClick={submit}
              className="bg-blue-700 hover:bg-blue-800"
            >
              <Shield className="mr-2 h-4 w-4" />
              <span className="font-noto-ethiopic">ጨርስ እና ወረዳ አስተዳዳሪ ፍጠር</span>
              <span className="ml-2 text-xs opacity-80">/ Finalize & Provision</span>
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function ReadRow({ am, en, value }: { am: string; en: string; value: string }) {
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <div className="text-xs text-slate-500">
        <span className="font-noto-ethiopic">{am}</span> / {en}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}
