import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { useReportBranding } from "@/hooks/useReportBranding";
import { P } from "@/config/permissions";
import { formatEthiopianDate, parseDateOnly } from "@/utils/ethiopianCalendar";
import {
  ETHNICITY_OPTIONS,
  RELIGION_OPTIONS,
  EDUCATION_OPTIONS,
  OCCUPATION_OPTIONS,
} from "@/lib/residentConstants";
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

export const Route = createFileRoute("/woreda/residents/$residentId/print")({
  ssr: false,
  component: ResidentProfilePrintPage,
});

interface BirthPlace {
  place_name?: string;
  region?: string;
  zone?: string;
  woreda?: string;
  kebele?: string;
}

interface WorkInfo {
  education_level?: string;
  occupation_status?: string;
  occupation_post?: string;
}

function optionLabel(
  options: readonly { value: string; am: string; en: string }[],
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const opt = options.find((o) => o.value === value);
  return opt ? `${opt.am} / ${opt.en}` : value;
}

function formatBirthPlace(bp: BirthPlace | null): string {
  if (!bp) return "—";
  if (bp.place_name?.trim()) return bp.place_name;
  const parts = [bp.kebele, bp.woreda, bp.zone, bp.region].filter(
    (x): x is string => !!x && x.trim().length > 0,
  );
  return parts.length ? parts.join(", ") : "—";
}

function ResidentProfilePrintPage() {
  const { residentId } = Route.useParams();
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const branding = useReportBranding();

  const { data: r, isPending } = useQuery({
    queryKey: ["resident-print", residentId, woredaId],
    enabled: !!woredaId && hasPermission(P.RESIDENT_READ),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select(
          `*,
           household:current_household_id (
             household_id, house_number, house_type, address_line,
             kebele:kebele_id ( kebele_number, kebele_name_am, kebele_name_en )
           )`,
        )
        .eq("resident_id", residentId)
        .eq("woreda_id", woredaId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // resident_decrypted isn't in the generated types yet (00000000000023_
  // pii_encryption.sql) -- same untyped-client cast pattern already used
  // elsewhere in this codebase for pre-typegen tables. Queried separately
  // rather than swapping the query above in place: that query embeds
  // household/kebele via a FK-derived PostgREST join, which is not
  // guaranteed to resolve through a view the same way it does through the
  // base table.
  const { data: contact } = useQuery({
    queryKey: ["resident-print-contact-decrypted", residentId, woredaId],
    enabled: !!woredaId && hasPermission(P.RESIDENT_READ),
    queryFn: async () => {
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data, error } = await db
        .from("resident_decrypted")
        .select("phone_number_decrypted, email_decrypted")
        .eq("resident_id", residentId)
        .eq("woreda_id", woredaId as string)
        .maybeSingle();
      if (error) throw error;
      return data as {
        phone_number_decrypted: string | null;
        email_decrypted: string | null;
      } | null;
    },
  });

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!r?.photo_url) {
        if (!cancelled) setPhotoUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from("resident-photos")
        .createSignedUrl(r.photo_url, 900);
      if (!cancelled) setPhotoUrl(data?.signedUrl ?? null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [r?.photo_url]);

  if (!hasPermission(P.RESIDENT_READ)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
        <p className="text-sm">You don't have permission to view this page.</p>
      </div>
    );
  }

  if (isPending) return <div className="py-20 text-center text-sm text-slate-500">Loading…</div>;
  if (!r) return <div className="py-20 text-center text-sm text-slate-500">Not found</div>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const household = r.household as any;
  const kebele = household?.kebele;
  const birthPlace = (r.birth_place as BirthPlace | null) ?? null;
  const workInfo = (r.work_info as WorkInfo | null) ?? null;

  const name = r.full_name_am || r.full_name;
  const dobEth = r.date_of_birth ? formatEthiopianDate(parseDateOnly(r.date_of_birth)!) : "—";
  const now = new Date();

  const houseTypeLabel: Record<string, string> = {
    private: "የግል / Private",
    kebele: "የቀበሌ / Kebele",
    rental: "የኪራይ / Rental",
    government: "የመንግስት / Government",
    rented_by_private: "ኪራይ በግለሰብ / Rented by Private",
    other: "ሌላ / Other",
  };

  return (
    <PrintDocumentShell
      backButton={
        <Link to="/woreda/residents/$residentId" params={{ residentId }}>
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
      docTagAm="የነዋሪ መገለጫ"
      docTagEn="Resident Profile"
      docNumberLabelAm="ቁ."
      docNumberLabelEn="No."
      docNumber={r.resident_number}
      dateEth={formatEthiopianDate(now)}
      dateGreg={now.toLocaleDateString("en-GB")}
      footer={
        <>
          <DocRecordFooter
            refLabel="የሰነድ ማጣቀሻ / Document Reference"
            refId={r.resident_number}
            printedOn={now.toLocaleDateString("en-GB")}
          />
          <div className="mt-4">
            <SystemAttributionFooter woredaNameAm={branding.data?.nameAm ?? ""} />
          </div>
        </>
      }
    >
      <DocSection number="01" titleAm="ማንነት" titleEn="Identity">
        <div className="grid grid-cols-[132px_1fr] items-start gap-6">
          <div className="h-[164px] w-[132px] border border-slate-300 bg-slate-100">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                ፎቶ · Photo
              </div>
            )}
          </div>
          <DocFieldGrid>
            <DocField labelAm="ሙሉ ስም" labelEn="Full Name" value={name} span={3} />
            <DocField labelAm="የነዋሪ መለያ ቁ." labelEn="Resident ID" value={r.resident_number} mono />
            <DocField
              labelAm="ጾታ"
              labelEn="Gender"
              value={r.sex === "female" ? "ሴት / Female" : "ወንድ / Male"}
            />
            <DocField labelAm="የትውልድ ቀን" labelEn="Date of Birth" value={dobEth} />
            <DocField
              labelAm="የትውልድ ቦታ"
              labelEn="Place of Birth"
              value={formatBirthPlace(birthPlace)}
            />
            <DocField
              labelAm="ብሔር"
              labelEn="Ethnicity"
              value={optionLabel(ETHNICITY_OPTIONS, r.ethnicity)}
            />
            <DocField
              labelAm="ሃይማኖት"
              labelEn="Religion"
              value={optionLabel(RELIGION_OPTIONS, r.religion)}
            />
          </DocFieldGrid>
        </div>
      </DocSection>

      <DocDivider />

      <DocSection number="02" titleAm="አድራሻ" titleEn="Contact & Residence">
        <DocFieldGrid>
          <DocField
            labelAm="ስልክ ቁጥር"
            labelEn="Phone"
            value={contact?.phone_number_decrypted || "—"}
            mono
          />
          <DocField labelAm="ኢሜይል" labelEn="Email" value={contact?.email_decrypted || "—"} />
          <DocField
            labelAm="የቤት ዓይነት"
            labelEn="House Type"
            value={household?.house_type ? houseTypeLabel[household.house_type] : "—"}
          />
          <DocField labelAm="ወረዳ" labelEn="Woreda" value={branding.data?.nameAm ?? "—"} />
          <DocField
            labelAm="ቀበሌ"
            labelEn="Kebele"
            value={kebele?.kebele_number != null ? String(kebele.kebele_number) : "—"}
          />
          <DocField
            labelAm="የቤት ቁጥር"
            labelEn="House Number"
            value={household?.house_number ?? "—"}
          />
          <DocField
            labelAm="አድራሻ"
            labelEn="Address"
            value={household?.address_line || "—"}
            span={3}
          />
        </DocFieldGrid>
      </DocSection>

      <DocDivider />

      <DocSection number="03" titleAm="ትምህርትና ሙያ" titleEn="Education & Occupation">
        <DocFieldGrid cols={2}>
          <DocField
            labelAm="የትምህርት ደረጃ"
            labelEn="Education"
            value={optionLabel(EDUCATION_OPTIONS, workInfo?.education_level)}
          />
          <DocField
            labelAm="ሙያ"
            labelEn="Occupation"
            value={
              workInfo?.occupation_post?.trim() ||
              optionLabel(OCCUPATION_OPTIONS, workInfo?.occupation_status)
            }
          />
        </DocFieldGrid>
      </DocSection>

      <DocDivider />

      <DocSection number="04" titleAm="ማረጋገጫ" titleEn="Certification">
        <DocSignatureBlock
          items={[
            { labelAm: "ፊርማ · ነዋሪ", labelEn: "Signature — Resident" },
            { labelAm: "ፊርማ · መዝጋቢ", labelEn: "Signature — Registrar" },
          ]}
        />
      </DocSection>
    </PrintDocumentShell>
  );
}
