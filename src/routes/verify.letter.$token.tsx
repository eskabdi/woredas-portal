import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";

export const Route = createFileRoute("/verify/letter/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Letter Verification — Woreda Administration Portal" },
      {
        name: "description",
        content:
          "Scan or open a woreda letter QR code to confirm the letter number, issue date, subject and recipient.",
      },
      { property: "og:title", content: "Letter Verification — Woreda Administration Portal" },
      {
        property: "og:description",
        content: "Confirm the authenticity of an official woreda administration letter.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LetterVerificationPage,
});

interface VerifiedLetter {
  request_number: string;
  issued_at: string | null;
  subject: string | null;
  resident_full_name: string | null;
  letter_summary: string | null;
  service_type_am: string | null;
  service_type_en: string | null;
  woreda_name_am: string | null;
  woreda_name_en: string | null;
  kebele_name_am: string | null;
  kebele_name_en: string | null;
}

function LetterVerificationPage() {
  const { token } = useParams({ from: "/verify/letter/$token" });

  const { data, isPending, isError } = useQuery({
    queryKey: ["verify-letter", token],
    retry: false,
    queryFn: async (): Promise<VerifiedLetter | null> => {
      const { data, error } = await supabase.rpc("verify_service_letter", { _token: token });
      if (error) throw error;
      const rows = (data ?? []) as VerifiedLetter[];
      return rows[0] ?? null;
    },
  });

  const verified = !!data;

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="font-noto-ethiopic mb-6 text-center text-lg font-bold text-slate-800">
          የደብዳቤ ማረጋገጫ / Letter Verification
        </h1>

        {isPending ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border bg-white p-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> ማረጋገጥ ላይ… / Verifying…
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div
              className={`flex flex-col items-center gap-2 px-6 py-8 text-center ${
                verified ? "bg-emerald-50" : "bg-red-50"
              }`}
            >
              {verified ? (
                <BadgeCheck className="h-16 w-16 text-emerald-600" aria-label="Verified" />
              ) : (
                <ShieldAlert className="h-16 w-16 text-red-600" aria-label="Unverified" />
              )}
              <div
                className={`font-noto-ethiopic text-lg font-bold ${
                  verified ? "text-emerald-800" : "text-red-800"
                }`}
              >
                {verified ? "የተረጋገጠ ደብዳቤ" : "ያልተረጋገጠ ደብዳቤ"}
              </div>
              <div
                className={`text-sm font-semibold uppercase tracking-wide ${
                  verified ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {verified ? "Verified" : "Unverified"}
              </div>
              {!verified && (
                <p className="font-noto-ethiopic mt-1 max-w-sm text-xs text-red-700">
                  {isError
                    ? "ማረጋገጥ አልተቻለም። እባክዎ ደግመው ይሞክሩ። / Verification could not be completed. Please try again."
                    : "ይህ QR ኮድ በዚህ ወረዳ አስተዳደር የተሰጠ ትክክለኛ ደብዳቤ አይመለከትም። / This QR code does not match any letter issued by the woreda administration."}
                </p>
              )}
            </div>

            {verified && data && (
              <dl className="divide-y text-sm">
                <Row
                  labelAm="የተሰጠበት ቀን"
                  labelEn="Date of issuance"
                  value={
                    data.issued_at
                      ? `${formatEthiopianDate(new Date(data.issued_at))} (${new Date(
                          data.issued_at,
                        ).toLocaleDateString("en-GB")})`
                      : "—"
                  }
                />
                <Row
                  labelAm="የደብዳቤ ቁጥር"
                  labelEn="Letter no."
                  value={data.request_number}
                  mono
                />
                <Row
                  labelAm="ጉዳይ"
                  labelEn="Subject of the letter"
                  value={
                    data.subject ??
                    data.service_type_am ??
                    data.service_type_en ??
                    "—"
                  }
                />
                <Row
                  labelAm="የነዋሪ ሙሉ ስም"
                  labelEn="Resident full name"
                  value={data.resident_full_name ?? "—"}
                />
                <Row
                  labelAm="ማጠቃለያ"
                  labelEn="Summary of the letter"
                  value={data.letter_summary ?? "—"}
                />
                <Row
                  labelAm="የሰጪው አካል"
                  labelEn="Issuing office"
                  value={[
                    data.woreda_name_am ?? data.woreda_name_en,
                    data.kebele_name_am ? `${data.kebele_name_am} ቀበሌ` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </dl>
            )}

            <div className="border-t bg-slate-50 px-6 py-3 text-center text-[11px] text-slate-500">
              Verification code: <span className="font-mono">{token}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
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
    <div className="grid grid-cols-[40%_60%] gap-2 px-6 py-3">
      <dt>
        <div className="font-noto-ethiopic text-xs font-medium text-slate-700">{labelAm}</div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400">{labelEn}</div>
      </dt>
      <dd
        className={`font-noto-ethiopic self-center break-words text-sm text-slate-900 ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
