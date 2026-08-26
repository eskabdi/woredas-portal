import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";
import { PAYMENT_TYPE_LABEL } from "@/utils/paymentType";

export const Route = createFileRoute("/verify/receipt/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Receipt Verification — Woreda Administration Portal" },
      {
        name: "description",
        content:
          "Scan or open a woreda revenue receipt QR code to confirm the receipt number, date, amount and payer.",
      },
      { property: "og:title", content: "Receipt Verification — Woreda Administration Portal" },
      {
        property: "og:description",
        content: "Confirm the authenticity of an official woreda administration revenue receipt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReceiptVerificationPage,
});

interface VerifiedReceipt {
  receipt_number: string;
  receipt_date: string;
  total_amount: number;
  payment_type: string;
  channel: string;
  printed_at: string | null;
  paid_by_full_name: string | null;
  paid_by_full_name_am: string | null;
  woreda_name_am: string | null;
  woreda_name_en: string | null;
  kebele_name_am: string | null;
  kebele_name_en: string | null;
}

function ReceiptVerificationPage() {
  const { token } = useParams({ from: "/verify/receipt/$token" });

  const { data, isPending, isError } = useQuery({
    queryKey: ["verify-receipt", token],
    retry: false,
    queryFn: async (): Promise<VerifiedReceipt | null> => {
      // verify_receipt() isn't in the generated types yet -- same temporary
      // inline cast pattern as useAuthBootstrap.ts's fetchConsolePermissions
      // (cast the call expression itself, not an extracted `supabase.rpc`
      // reference -- extracting it into its own const would strip the `this`
      // binding SupabaseClient#rpc needs; see admin.credential-template.tsx's
      // db/rpc comment for why that specific shape broke Publish there).
      // Regenerate types.ts post-deploy and drop this.
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: { _token: string },
        ) => Promise<{ data: VerifiedReceipt[] | null; error: { message: string } | null }>
      )("verify_receipt", { _token: token });
      if (error) throw error;
      const rows = data ?? [];
      return rows[0] ?? null;
    },
  });

  const verified = !!data;

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="font-noto-ethiopic mb-6 text-center text-lg font-bold text-slate-800">
          የደረሰኝ ማረጋገጫ / Receipt Verification
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
                {verified ? "የተረጋገጠ ደረሰኝ" : "ያልተረጋገጠ ደረሰኝ"}
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
                    : "ይህ QR ኮድ በዚህ ወረዳ አስተዳደር የተሰጠ ትክክለኛ ደረሰኝ አይመለከትም። / This QR code does not match any receipt issued by the woreda administration."}
                </p>
              )}
            </div>

            {verified && data && (
              <dl className="divide-y text-sm">
                <Row
                  labelAm="የተሰጠበት ቀን"
                  labelEn="Date of issuance"
                  value={`${formatEthiopianDate(new Date(data.receipt_date))} (${new Date(
                    data.receipt_date,
                  ).toLocaleDateString("en-GB")})`}
                />
                <Row labelAm="ደረሰኝ ቁጥር" labelEn="Receipt no." value={data.receipt_number} mono />
                <Row
                  labelAm="ዓይነት"
                  labelEn="Payment type"
                  value={PAYMENT_TYPE_LABEL[data.payment_type] ?? data.payment_type}
                />
                <Row
                  labelAm="ከፋይ"
                  labelEn="Paid by"
                  value={data.paid_by_full_name_am ?? data.paid_by_full_name ?? "—"}
                />
                <Row
                  labelAm="የተከፈለ መጠን"
                  labelEn="Amount paid"
                  value={`${Number(data.total_amount).toLocaleString()} ETB`}
                  mono
                />
                <Row
                  labelAm="ቻናል"
                  labelEn="Channel"
                  value={data.channel === "cash" ? "ጥሬ ገንዘብ · Cash" : data.channel}
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
