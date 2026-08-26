import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { useReportBranding } from "@/hooks/useReportBranding";
import { P } from "@/config/permissions";
import { formatEthiopianDate, parseDateOnly } from "@/utils/ethiopianCalendar";
import {
  PrintDocumentShell,
  DocSection,
  DocDivider,
  DocFieldGrid,
  DocField,
  DocSignatureBlock,
  DocRecordFooter,
  SystemAttributionFooter,
} from "@/components/print/PrintDocumentShell";

export const Route = createFileRoute("/woreda/households/$householdId/print")({
  ssr: false,
  component: HouseholdProfilePrintPage,
});

const HOUSE_TYPE_LABEL: Record<string, string> = {
  private: "የግል / Private",
  kebele: "የቀበሌ / Kebele",
  rental: "የኪራይ / Rental",
  government: "የመንግስት / Government",
  rented_by_private: "ኪራይ በግለሰብ / Rented by Private",
  other: "ሌላ / Other",
};

function calcAge(dob: string | null | undefined): string {
  if (!dob) return "—";
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return "—";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return String(age);
}

function HouseholdProfilePrintPage() {
  const { householdId } = Route.useParams();
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const branding = useReportBranding();

  const { data: household, isPending } = useQuery({
    queryKey: ["household-print", householdId, woredaId],
    enabled: !!woredaId && hasPermission(P.HOUSEHOLD_READ),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("household")
        .select(
          `*,
           kebele:kebele_id ( kebele_number, kebele_name_am, kebele_name_en ),
           head:resident!household_head_resident_id ( resident_id, full_name_am, full_name ),
           spouse:resident!spouse_resident_id ( resident_id, full_name_am, full_name ),
           alt_head:resident!alternate_head_resident_id ( resident_id, full_name_am, full_name )`,
        )
        .eq("household_id", householdId)
        .eq("woreda_id", woredaId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: members } = useQuery({
    queryKey: ["household-print-members", householdId],
    enabled: !!woredaId && hasPermission(P.HOUSEHOLD_READ),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select("resident_id, full_name_am, full_name, relation_to_head, sex, date_of_birth")
        .eq("current_household_id", householdId)
        .eq("woreda_id", woredaId as string)
        .order("full_name_am");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!hasPermission(P.HOUSEHOLD_READ)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
        <p className="text-sm">You don't have permission to view this page.</p>
      </div>
    );
  }

  if (isPending) return <div className="py-20 text-center text-sm text-slate-500">Loading…</div>;
  if (!household) return <div className="py-20 text-center text-sm text-slate-500">Not found</div>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = household as any;
  const kebele = h.kebele;
  const head = h.head;
  const spouse = h.spouse;
  const altHead = h.alt_head;
  const now = new Date();

  return (
    <PrintDocumentShell
      backButton={
        <Link to="/woreda/households/$householdId" params={{ householdId }}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> ተመለስ / Back
          </Button>
        </Link>
      }
      logoDataUrl={branding.data?.logoDataUrl}
      woredaNameAm={branding.data?.nameAm ?? ""}
      woredaNameEn={branding.data?.nameEn ?? ""}
      contactLine={
        [branding.data?.addressLine, branding.data?.contactPhone, branding.data?.contactEmail]
          .filter(Boolean)
          .join(" · ") || null
      }
      docTagAm="የቤተሰብ መገለጫ"
      docTagEn="Household Profile"
      docNumberLabelAm="የቤት ቁ."
      docNumberLabelEn="House No."
      docNumber={h.house_number}
      dateEth={formatEthiopianDate(now)}
      dateGreg={now.toLocaleDateString("en-GB")}
      footer={
        <>
          <DocRecordFooter
            refLabel="የሰነድ ማጣቀሻ / Document Reference"
            refId={`${kebele?.kebele_number ?? "—"}/${h.house_number}`}
            printedOn={now.toLocaleDateString("en-GB")}
          />
          <div className="mt-4">
            <SystemAttributionFooter woredaNameAm={branding.data?.nameAm ?? ""} />
          </div>
        </>
      }
    >
      <DocSection number="01" titleAm="የቤት አድራሻ" titleEn="House & Location">
        <DocFieldGrid>
          <DocField labelAm="የቤት ቁጥር" labelEn="House Number" value={h.house_number} />
          <DocField
            labelAm="የቤት ዓይነት"
            labelEn="House Type"
            value={h.house_type ? HOUSE_TYPE_LABEL[h.house_type] : "—"}
          />
          <DocField labelAm="ወረዳ" labelEn="Woreda" value={branding.data?.nameAm ?? "—"} />
          <DocField
            labelAm="ቀበሌ"
            labelEn="Kebele"
            value={kebele?.kebele_number != null ? String(kebele.kebele_number) : "—"}
          />
          <DocField labelAm="ስልክ ቁጥር" labelEn="Phone" value={h.phone_number || "—"} mono />
          <DocField labelAm="ኢሜይል" labelEn="Email" value={h.email || "—"} />
          <DocField labelAm="አድራሻ" labelEn="Address" value={h.address_line || "—"} span={3} />
        </DocFieldGrid>
      </DocSection>

      <DocDivider />

      <DocSection number="02" titleAm="የቤተሰብ ራስ" titleEn="Household Head">
        <DocFieldGrid>
          <DocField
            labelAm="የቤተሰብ ራስ"
            labelEn="Household Head"
            value={head?.full_name_am || head?.full_name || "—"}
          />
          <DocField
            labelAm="የትዳር ጓደኛ"
            labelEn="Spouse"
            value={spouse?.full_name_am || spouse?.full_name || "የለም · None"}
          />
          <DocField
            labelAm="ተለዋጭ ኃላፊ"
            labelEn="Alternate Head"
            value={altHead?.full_name_am || altHead?.full_name || "የለም · None"}
          />
        </DocFieldGrid>
      </DocSection>

      <DocDivider />

      <DocSection
        number="03"
        titleAm="የቤተሰብ አባላት"
        titleEn={`Household Members (${members?.length ?? 0})`}
      >
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="pb-1.5 pr-3 font-noto-ethiopic font-semibold text-slate-700">
                ስም <span className="block text-[9px] font-normal text-slate-400">Full Name</span>
              </th>
              <th className="pb-1.5 pr-3 font-noto-ethiopic font-semibold text-slate-700">
                ግንኙነት
                <span className="block text-[9px] font-normal text-slate-400">
                  Relation to Head
                </span>
              </th>
              <th className="pb-1.5 pr-3 font-noto-ethiopic font-semibold text-slate-700">
                ጾታ <span className="block text-[9px] font-normal text-slate-400">Sex</span>
              </th>
              <th className="pb-1.5 font-noto-ethiopic font-semibold text-slate-700">
                ዕድሜ <span className="block text-[9px] font-normal text-slate-400">Age</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-slate-400">
                  ምንም አባል የለም / No members
                </td>
              </tr>
            )}
            {(members ?? []).map((m) => (
              <tr key={m.resident_id} className="border-b border-slate-100">
                <td className="py-1.5 pr-3">
                  <div className="font-noto-ethiopic font-medium text-slate-900">
                    {m.full_name_am || m.full_name}
                  </div>
                  {m.full_name_am && m.full_name && (
                    <div className="text-[10px] text-slate-500">{m.full_name}</div>
                  )}
                </td>
                <td className="py-1.5 pr-3 font-noto-ethiopic text-slate-700">
                  {m.relation_to_head || "—"}
                </td>
                <td className="py-1.5 pr-3 font-noto-ethiopic text-slate-700">
                  {m.sex === "female" ? "ሴት" : "ወንድ"}
                </td>
                <td className="py-1.5 text-slate-700">{calcAge(m.date_of_birth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DocSection>

      <DocDivider />

      <DocSection number="04" titleAm="ማረጋገጫ" titleEn="Certification">
        <DocSignatureBlock
          items={[
            { labelAm: "ፊርማ · የቤተሰብ ራስ", labelEn: "Signature — Household Head" },
            { labelAm: "ፊርማ · የቀበሌ ሠራተኛ", labelEn: "Signature — Kebele Officer" },
          ]}
        />
      </DocSection>
    </PrintDocumentShell>
  );
}
