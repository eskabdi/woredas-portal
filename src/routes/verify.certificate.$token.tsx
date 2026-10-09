import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Loader2, ShieldAlert } from "lucide-react";

import { CERTIFICATE_TYPE_LABELS } from "@/config/certificateFields";
import { isCertificateType } from "@/lib/certificateData";
import { supabase } from "@/integrations/supabase/client";
import { formatEthiopianDateOnly } from "@/utils/ethiopianCalendar";

export const Route = createFileRoute("/verify/certificate/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Certificate Verification — Woreda Administration Portal" },
      {
        name: "description",
        content:
          "Scan a civil-registration certificate's QR code to confirm it was issued by the woreda administration.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CertificateVerificationPage,
});

interface VerifiedCertificate {
  certificate_type: string;
  registration_number: string | null;
  event_date: string | null;
  registration_date: string | null;
  issued_at: string | null;
  subject_name_am: string | null;
  subject_name_en: string | null;
  second_party_name_am: string | null;
  second_party_name_en: string | null;
  woreda_name_am: string | null;
  woreda_name_en: string | null;
}

const TOKEN_RE = /^[A-HJ-NP-Z2-9]{26}$/;

const both = (am: string | null, en: string | null) =>
  [am, en].filter((v) => v && v.trim()).join(" / ") || "—";

function CertificateVerificationPage() {
  const { token } = useParams({ from: "/verify/certificate/$token" });
  const wellFormed = TOKEN_RE.test(token);

  const { data, isPending, isError } = useQuery({
    queryKey: ["verify-certificate", token],
    enabled: wellFormed,
    retry: false,
    queryFn: async (): Promise<VerifiedCertificate | null> => {
      const { data, error } = await supabase.rpc(
        "verify_civil_certificate" as never,
        {
          _token: token,
        } as never,
      );
      if (error) throw error;
      const rows = (data ?? []) as unknown as VerifiedCertificate[];
      return rows[0] ?? null;
    },
  });

  // Fail closed: a malformed token, an RPC error or no row all read as "not
  // verified" -- never green on an absence of evidence.
  const verified = wellFormed && !!data;
  const label =
    data && isCertificateType(data.certificate_type)
      ? CERTIFICATE_TYPE_LABELS[data.certificate_type]
      : null;
  const pairLabel =
    data?.certificate_type === "marriage"
      ? { first: ["ሚስት", "Wife"], second: ["ባል", "Husband"] }
      : data?.certificate_type === "divorce"
        ? { first: ["ተፋቺ 1", "Divorcee 1"], second: ["ተፋቺ 2", "Divorcee 2"] }
        : { first: ["ስም", "Name"], second: null };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="font-am-heading mb-6 text-center text-lg font-bold text-slate-800">
          የምስክር ወረቀት ማረጋገጫ / Certificate Verification
        </h1>

        {wellFormed && isPending ? (
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
                className={`font-am-body text-lg font-bold ${
                  verified ? "text-emerald-800" : "text-red-800"
                }`}
              >
                {verified ? "የተረጋገጠ የምስክር ወረቀት" : "ያልተረጋገጠ የምስክር ወረቀት"}
              </div>
              <div
                className={`text-sm font-semibold uppercase tracking-wide ${
                  verified ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {verified ? "Verified" : "Not verified"}
              </div>
              {!verified && (
                <p className="font-am-body mt-1 max-w-sm text-xs text-red-700">
                  {isError
                    ? "ማረጋገጥ አልተቻለም። እባክዎ ደግመው ይሞክሩ። / Verification could not be completed. Please try again."
                    : "ይህ QR ኮድ በወረዳ አስተዳደሩ የተሰጠ የምስክር ወረቀት አይመለከትም። / This QR code does not match any certificate issued by the woreda administration."}
                </p>
              )}
            </div>

            {verified && data && (
              <dl className="divide-y text-sm">
                <Row
                  am="የምስክር ወረቀት ዓይነት"
                  en="Certificate"
                  value={label ? `${label.am} / ${label.en}` : data.certificate_type}
                />
                <Row
                  am="የምዝገባ ቁጥር"
                  en="Registration number"
                  value={data.registration_number ?? "—"}
                  mono
                />
                <Row
                  am={pairLabel.first[0]}
                  en={pairLabel.first[1]}
                  value={both(data.subject_name_am, data.subject_name_en)}
                />
                {pairLabel.second && (
                  <Row
                    am={pairLabel.second[0]}
                    en={pairLabel.second[1]}
                    value={both(data.second_party_name_am, data.second_party_name_en)}
                  />
                )}
                <Row
                  am="የኩነቱ ቀን"
                  en="Date of event"
                  value={data.event_date ? formatEthiopianDateOnly(data.event_date) : "—"}
                />
                <Row
                  am="የምዝገባ ቀን"
                  en="Date of registration"
                  value={
                    data.registration_date ? formatEthiopianDateOnly(data.registration_date) : "—"
                  }
                />
                <Row
                  am="የተሰጠበት ቀን"
                  en="Date issued"
                  value={
                    data.issued_at ? formatEthiopianDateOnly(data.issued_at.slice(0, 10)) : "—"
                  }
                />
                <Row
                  am="የሰጪው አካል"
                  en="Issuing office"
                  value={both(data.woreda_name_am, data.woreda_name_en)}
                />
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ am, en, value, mono }: { am: string; en: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 px-5 py-3">
      <dt className="text-slate-500">
        <span className="font-am-body block">{am}</span>
        <span className="text-xs">{en}</span>
      </dt>
      <dd className={`font-am-body text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
