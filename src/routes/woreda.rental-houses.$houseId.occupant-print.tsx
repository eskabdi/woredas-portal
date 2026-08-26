import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { useReportBranding } from "@/hooks/useReportBranding";
import { P } from "@/config/permissions";
import { formatEthiopianDate, parseDateOnly } from "@/utils/ethiopianCalendar";
import { EDUCATION_OPTIONS, OCCUPATION_OPTIONS } from "@/lib/residentConstants";
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

export const Route = createFileRoute("/woreda/rental-houses/$houseId/occupant-print")({
  ssr: false,
  component: RentalOccupantPrintPage,
});

interface WorkInfo {
  education_level?: string;
  occupation_status?: string;
  occupation_post?: string;
  work_address?: string;
}

interface BirthPlace {
  place_name?: string;
  region?: string;
  zone?: string;
  woreda?: string;
  kebele?: string;
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

const OCCUPANCY_STATUS_LABEL: Record<string, string> = {
  vacant: "ክፍት · Vacant",
  occupied: "ተይዟል · Occupied",
  under_maintenance: "በጥገና ላይ · Under Maintenance",
};

const HISTORY_STATUS_LABEL: Record<string, string> = {
  active: "ንቁ · Active",
  vacated: "ተለቋል · Vacated",
  terminated: "ተቋርጧል · Terminated",
};

function RentalOccupantPrintPage() {
  const { houseId } = Route.useParams();
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const branding = useReportBranding();

  const { data: house, isPending: housePending } = useQuery({
    queryKey: ["rental-house-print", houseId, woredaId],
    enabled: !!woredaId && hasPermission(P.RENTAL_VIEW),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele_rental_house")
        .select(`*, kebele:kebele_id ( kebele_number, kebele_name_am, kebele_name_en )`)
        .eq("rental_house_id", houseId)
        .eq("woreda_id", woredaId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: occupancies, isPending: occPending } = useQuery({
    queryKey: ["rental-occupancies-print", houseId, woredaId],
    enabled: !!woredaId && hasPermission(P.RENTAL_VIEW),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_occupancy")
        .select(
          `occupancy_id, rent_start_date, rent_amount, status, termination_date,
           resident:resident_id (
             resident_id, resident_number, full_name_am, full_name, sex, date_of_birth,
             phone_number, birth_place, work_info
           )`,
        )
        .eq("rental_house_id", houseId)
        .eq("woreda_id", woredaId as string)
        .order("rent_start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!hasPermission(P.RENTAL_VIEW)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
        <p className="text-sm">You don't have permission to view this page.</p>
      </div>
    );
  }

  if (housePending || occPending)
    return <div className="py-20 text-center text-sm text-slate-500">Loading…</div>;
  if (!house) return <div className="py-20 text-center text-sm text-slate-500">Not found</div>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = house as any;
  const kebele = h.kebele;
  const active = (occupancies ?? []).find((o) => o.status === "active");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occupant = active?.resident as any;
  const birthPlace = (occupant?.birth_place as BirthPlace | null) ?? null;
  const workInfo = (occupant?.work_info as WorkInfo | null) ?? null;
  const now = new Date();

  return (
    <PrintDocumentShell
      backButton={
        <Link to="/woreda/rental-houses/$houseId" params={{ houseId }}>
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
      docTagAm="የቀበሌ ኪራይ ቤት ተከራይ መገለጫ"
      docTagEn="Kebele Rental House Occupant Profile"
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
      <DocSection number="01" titleAm="የቤት ዝርዝር" titleEn="House Details">
        <DocFieldGrid>
          <DocField labelAm="የቤት ቁጥር" labelEn="House Number" value={h.house_number} />
          <DocField
            labelAm="ሁኔታ"
            labelEn="Occupancy Status"
            value={OCCUPANCY_STATUS_LABEL[h.occupancy_status] ?? h.occupancy_status}
          />
          <DocField labelAm="ወረዳ" labelEn="Woreda" value={branding.data?.nameAm ?? "—"} />
          <DocField
            labelAm="ቀበሌ"
            labelEn="Kebele"
            value={kebele?.kebele_number != null ? String(kebele.kebele_number) : "—"}
          />
          <DocField labelAm="የመኝታ ክፍሎች" labelEn="Bedrooms" value={h.bedrooms ?? "—"} />
          <DocField
            labelAm="ወርሃዊ ኪራይ (መደበኛ)"
            labelEn="Monthly Rent (Standard)"
            value={
              h.monthly_rent_standard != null
                ? `ብር ${Number(h.monthly_rent_standard).toFixed(2)}`
                : "—"
            }
          />
        </DocFieldGrid>
      </DocSection>

      <DocDivider />

      <DocSection number="02" titleAm="የተከራይ መረጃ" titleEn="Occupant Information">
        {occupant ? (
          <DocFieldGrid>
            <DocField
              labelAm="ሙሉ ስም"
              labelEn="Full Name"
              value={occupant.full_name_am || occupant.full_name}
              span={2}
            />
            <DocField
              labelAm="የነዋሪ መለያ ቁ."
              labelEn="Resident ID"
              value={occupant.resident_number}
              mono
            />
            <DocField
              labelAm="ጾታ"
              labelEn="Sex"
              value={occupant.sex === "female" ? "ሴት / Female" : "ወንድ / Male"}
            />
            <DocField
              labelAm="የትውልድ ቀን"
              labelEn="Date of Birth"
              value={
                occupant.date_of_birth
                  ? formatEthiopianDate(parseDateOnly(occupant.date_of_birth)!)
                  : "—"
              }
            />
            <DocField
              labelAm="የትውልድ ቦታ"
              labelEn="Place of Birth"
              value={formatBirthPlace(birthPlace)}
            />
            <DocField labelAm="ስልክ ቁጥር" labelEn="Phone" value={occupant.phone_number || "—"} mono />
            <DocField
              labelAm="ሙያ"
              labelEn="Occupation"
              value={
                workInfo?.occupation_post?.trim() ||
                optionLabel(OCCUPATION_OPTIONS, workInfo?.occupation_status)
              }
            />
            <DocField
              labelAm="የስራ አድራሻ"
              labelEn="Work Address"
              value={workInfo?.work_address || "—"}
              span={2}
            />
          </DocFieldGrid>
        ) : (
          <p className="font-noto-ethiopic text-sm text-slate-500">
            ይህ ቤት በአሁኑ ጊዜ ተከራይ የለውም / This house currently has no active occupant
          </p>
        )}
      </DocSection>

      {active && (
        <>
          <DocDivider />
          <DocSection number="03" titleAm="የኪራይ ዝርዝር" titleEn="Tenancy Details">
            <DocFieldGrid>
              <DocField
                labelAm="ኪራይ የጀመረበት ቀን"
                labelEn="Rent Start Date"
                value={
                  active.rent_start_date
                    ? formatEthiopianDate(parseDateOnly(active.rent_start_date)!)
                    : "—"
                }
              />
              <DocField
                labelAm="የተስማማበት ወርሃዊ ኪራይ"
                labelEn="Agreed Monthly Rent"
                value={`ብር ${Number(active.rent_amount).toFixed(2)}`}
              />
              <DocField
                labelAm="የተቋረጠበት ቀን"
                labelEn="Termination Date"
                value={
                  active.termination_date
                    ? formatEthiopianDate(parseDateOnly(active.termination_date)!)
                    : "የለም · None"
                }
              />
            </DocFieldGrid>
          </DocSection>
        </>
      )}

      <DocDivider />

      <DocSection number={active ? "04" : "03"} titleAm="የመኖሪያ ታሪክ" titleEn="Occupancy History">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="pb-1.5 pr-3 font-noto-ethiopic font-semibold text-slate-700">
                ተከራይ <span className="block text-[9px] font-normal text-slate-400">Occupant</span>
              </th>
              <th className="pb-1.5 pr-3 font-noto-ethiopic font-semibold text-slate-700">
                ጊዜ <span className="block text-[9px] font-normal text-slate-400">Period</span>
              </th>
              <th className="pb-1.5 font-noto-ethiopic font-semibold text-slate-700">
                ሁኔታ <span className="block text-[9px] font-normal text-slate-400">Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(occupancies ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-center text-slate-400">
                  ምንም መዝገብ የለም / No records
                </td>
              </tr>
            )}
            {(occupancies ?? []).map((o) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const res = o.resident as any;
              const start = o.rent_start_date
                ? new Date(o.rent_start_date).toLocaleDateString("en-GB")
                : "—";
              const end = o.termination_date
                ? new Date(o.termination_date).toLocaleDateString("en-GB")
                : "እስካሁን · Present";
              return (
                <tr key={o.occupancy_id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3">
                    <div className="font-noto-ethiopic font-medium text-slate-900">
                      {res?.full_name_am || res?.full_name || "—"}
                    </div>
                    {res?.full_name_am && res?.full_name && (
                      <div className="text-[10px] text-slate-500">{res.full_name}</div>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-700">
                    {start} – {end}
                  </td>
                  <td className="py-1.5 font-noto-ethiopic text-slate-700">
                    {HISTORY_STATUS_LABEL[o.status] ?? o.status}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DocSection>

      <DocDivider />

      <DocSection number={active ? "05" : "04"} titleAm="ማረጋገጫ" titleEn="Certification">
        <DocSignatureBlock
          items={[
            { labelAm: "ፊርማ · ተከራይ", labelEn: "Signature — Occupant" },
            { labelAm: "ፊርማ · የቀበሌ አስተዳዳሪ", labelEn: "Signature — Kebele Administrator" },
          ]}
        />
      </DocSection>
    </PrintDocumentShell>
  );
}
