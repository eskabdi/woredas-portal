import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Loader2, ShieldAlert, ShieldX, Clock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { verifyCredentialToken } from "@/utils/harariCredentialCrypto";
import type { HarariQRVerificationPayload } from "@/utils/harariCredentialCrypto";

/**
 * Public verification of a residence ID card.
 *
 * Reached by scanning the QR on the back of the card with any phone camera — no
 * app and no account. Two independent checks happen here:
 *
 *   1. The signature is verified in the browser against the bundled public key.
 *      This proves the data was issued by the regional government and has not
 *      been altered, and it works even if the registry is unreachable.
 *   2. The registry is asked for the card's current status, because a revoked
 *      card still carries a perfectly valid signature.
 *
 * Anonymous visitors see only enough to confirm a card is genuine. The photo and
 * full date of birth come back solely for signed-in woreda staff — enforced in
 * verify_credential_token(), not here.
 */
export const Route = createFileRoute("/v/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ID Card Verification — Woreda Administration Portal" },
      {
        name: "description",
        content:
          "Scan a Harari residence ID card QR code to confirm the card is genuine and still valid.",
      },
      { property: "og:title", content: "ID Card Verification" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CredentialVerificationPage,
});

interface RegistryRow {
  credential_number: string;
  status: string;
  issue_date: string | null;
  expiry_date: string | null;
  resident_full_name: string | null;
  woreda_name_am: string | null;
  woreda_name_en: string | null;
  kebele_name_am: string | null;
  kebele_name_en: string | null;
  photo_path: string | null;
  date_of_birth: string | null;
}

interface VerificationResult {
  signatureValid: boolean;
  signatureError: string | null;
  expired: boolean;
  payload: HarariQRVerificationPayload | null;
  registry: RegistryRow | null;
  registryError: string | null;
  photoUrl: string | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="font-noto-ethiopic mb-6 text-center text-lg font-bold text-slate-800">
          የመታወቂያ ማረጋገጫ / ID Card Verification
        </h1>
        {children}
      </div>
    </div>
  );
}

function Row({ labelAm, labelEn, value }: { labelAm: string; labelEn: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-baseline sm:gap-3">
      <div className="w-44 shrink-0 text-xs text-slate-500">
        <span className="font-noto-ethiopic">{labelAm}</span>
        <span className="ml-1">/ {labelEn}</span>
      </div>
      <div className="break-words text-sm font-medium text-slate-900">{value || "—"}</div>
    </div>
  );
}

function CredentialVerificationPage() {
  const { token } = useParams({ from: "/v/$token" });

  const { data, isPending } = useQuery({
    queryKey: ["verify-credential", token],
    retry: false,
    queryFn: async (): Promise<VerificationResult> => {
      const verified = await verifyCredentialToken(token);

      // A bad signature ends it. Asking the registry about a forged number would
      // only lend the forgery credibility.
      if (!verified.valid || !verified.payload) {
        return {
          signatureValid: false,
          signatureError: verified.error,
          expired: false,
          payload: null,
          registry: null,
          registryError: null,
          photoUrl: null,
        };
      }

      let registry: RegistryRow | null = null;
      let registryError: string | null = null;
      let photoUrl: string | null = null;
      try {
        const { data: rows, error } = await supabase.rpc("verify_credential_token", {
          _credential_digits: verified.payload.credentialNumber,
        });
        if (error) throw error;
        registry = ((rows ?? []) as RegistryRow[])[0] ?? null;
        if (registry?.photo_path) {
          const { data: signed } = await supabase.storage
            .from("resident-photos")
            .createSignedUrl(registry.photo_path, 600);
          photoUrl = signed?.signedUrl ?? null;
        }
      } catch (e) {
        // The signature already stands on its own; say the live check failed
        // rather than implying the card is bad.
        registryError = (e as Error).message;
      }

      return {
        signatureValid: true,
        signatureError: null,
        expired: verified.expired,
        payload: verified.payload,
        registry,
        registryError,
        photoUrl,
      };
    },
  });

  if (isPending) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 rounded-xl border bg-white p-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> ማረጋገጥ ላይ… / Verifying…
        </div>
      </Shell>
    );
  }

  if (!data?.signatureValid) {
    return (
      <Shell>
        <div className="rounded-xl border border-red-200 bg-white p-8 text-center">
          <ShieldX className="mx-auto h-10 w-10 text-red-600" />
          <h2 className="font-noto-ethiopic mt-3 text-base font-bold text-red-700">
            ትክክለኛ መታወቂያ አይደለም
          </h2>
          <p className="mt-1 text-sm font-medium text-red-700">Not a valid card</p>
          <p className="mt-3 text-sm text-slate-600">
            This code was not issued by the Harari Regional Government, or it has been
            altered since it was issued.
          </p>
        </div>
      </Shell>
    );
  }

  const payload = data.payload!;
  const registry = data.registry;
  const notFound = !registry && !data.registryError;

  // Enumerated rather than negated: "printed" is a normal state for a card in
  // someone's wallet, and treating anything-but-active as bad would tell a
  // holder their valid card had been revoked.
  const WITHDRAWN = ["revoked", "suspended", "replaced"];
  const withdrawn = !!registry && WITHDRAWN.includes(registry.status);
  const notYetIssued = registry?.status === "ready_to_print";
  const expired = data.expired || registry?.status === "expired";

  return (
    <Shell>
      <div className="overflow-hidden rounded-xl border bg-white">
        {/* Verdict banner — signature is proven; live status may qualify it. */}
        {withdrawn ? (
          <div className="flex items-center gap-3 bg-red-50 px-5 py-4">
            <ShieldX className="h-6 w-6 shrink-0 text-red-600" />
            <div>
              <div className="font-noto-ethiopic font-bold text-red-800">ይህ መታወቂያ ተሰርዟል</div>
              <div className="text-sm text-red-700">
                Signature is genuine, but the registry lists this card as {registry!.status}.
              </div>
            </div>
          </div>
        ) : notYetIssued ? (
          <div className="flex items-center gap-3 bg-amber-50 px-5 py-4">
            <Clock className="h-6 w-6 shrink-0 text-amber-600" />
            <div>
              <div className="font-noto-ethiopic font-bold text-amber-800">ገና አልተሰጠም</div>
              <div className="text-sm text-amber-700">
                This card has been prepared but not yet issued to its holder.
              </div>
            </div>
          </div>
        ) : expired ? (
          <div className="flex items-center gap-3 bg-amber-50 px-5 py-4">
            <Clock className="h-6 w-6 shrink-0 text-amber-600" />
            <div>
              <div className="font-noto-ethiopic font-bold text-amber-800">
                የአገልግሎት ጊዜው አብቅቷል
              </div>
              <div className="text-sm text-amber-700">Genuine card, but it has expired.</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-emerald-50 px-5 py-4">
            <BadgeCheck className="h-6 w-6 shrink-0 text-emerald-600" />
            <div>
              <div className="font-noto-ethiopic font-bold text-emerald-800">
                የተረጋገጠ ትክክለኛ መታወቂያ
              </div>
              <div className="text-sm text-emerald-700">
                Issued by the Harari Regional Government.
              </div>
            </div>
          </div>
        )}

        {(data.registryError || notFound) && (
          <div className="flex items-start gap-2 border-t bg-slate-50 px-5 py-3 text-xs text-slate-600">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>
              {notFound
                ? "This card's signature is genuine, but the registry has no record of it. Report it to the issuing woreda."
                : "The signature was verified offline. The registry could not be reached, so the card's current status is unknown."}
            </span>
          </div>
        )}

        <div className="px-5 py-4">
          {data.photoUrl && (
            <img
              src={data.photoUrl}
              alt=""
              className="mb-4 h-40 w-40 rounded-lg border border-slate-200 object-cover"
            />
          )}
          <Row labelAm="ስም" labelEn="Full Name" value={payload.fullNameEnglish} />
          <Row labelAm="መ.ቁ" labelEn="Card Number" value={payload.credentialNumber} />
          <Row labelAm="ወረዳ" labelEn="Woreda" value={payload.woreda} />
          <Row labelAm="ቀበሌ" labelEn="Kebele" value={payload.kebele} />
          <Row labelAm="የተሰጠበት" labelEn="Issued" value={payload.issueDate} />
          <Row labelAm="የሚያበቃበት" labelEn="Expires" value={payload.expiryDate} />
          {registry?.date_of_birth && (
            <Row labelAm="የልደት ቀን" labelEn="Date of Birth" value={registry.date_of_birth} />
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        <span className="font-noto-ethiopic">የሐረሪ ክልል መስተዳድር</span> / Harari Regional Government
      </p>
    </Shell>
  );
}
