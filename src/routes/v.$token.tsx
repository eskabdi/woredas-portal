import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Loader2, ShieldAlert, ShieldX, Clock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { credentialVerdict } from "@/lib/credentialVerdict";
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
 * The verdict fails closed (credentialVerdict(), security audit 2026-09-24,
 * WP-CRY-001): green only when the registry answers `active`. No registry row
 * is red; a registry that cannot be reached or is rate-limiting is amber
 * ("genuine, status unknown"). Neither ever shows the green banner.
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
        <h1 className="font-am-heading mb-6 text-center text-lg font-bold text-slate-800">
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
        <span className="font-am-body">{labelAm}</span>
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
          _token: token,
        });
        if (error) throw error;
        registry = ((rows ?? []) as RegistryRow[])[0] ?? null;
      } catch (e) {
        // The signature already stands on its own; the verdict becomes
        // "status unknown" (amber), never green.
        registryError = (e as Error).message || "registry unavailable";
      }
      if (registry?.photo_path) {
        // Kept apart from the status lookup: a photo that fails to load must
        // not turn a known status into "unknown".
        try {
          const { data: signed } = await supabase.storage
            .from("resident-photos")
            .createSignedUrl(registry.photo_path, 600);
          photoUrl = signed?.signedUrl ?? null;
        } catch {
          photoUrl = null;
        }
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
          <h2 className="font-am-heading mt-3 text-base font-bold text-red-700">
            ትክክለኛ መታወቂያ አይደለም
          </h2>
          <p className="mt-1 text-sm font-medium text-red-700">Not a valid card</p>
          <p className="mt-3 text-sm text-slate-600">
            This code was not issued by the Harari Regional Government, or it has been altered since
            it was issued.
          </p>
        </div>
      </Shell>
    );
  }

  const payload = data.payload!;
  const registry = data.registry;
  const verdict = credentialVerdict({
    signatureValid: true,
    payloadExpired: data.expired,
    registryAnswered: !data.registryError,
    registryStatus: registry?.status ?? null,
  });
  // A withdrawn card, or one the registry does not know, reveals nothing
  // beyond its banner -- see the note above the details block.
  const hideDetails = verdict === "withdrawn" || verdict === "not_found";

  return (
    <Shell>
      <div className="overflow-hidden rounded-xl border bg-white">
        {/* Verdict banner. Green is reserved for a registry status of
            `active`; every other outcome is amber or red. */}
        {verdict === "withdrawn" ? (
          <div className="flex items-center gap-3 bg-red-50 px-5 py-4" data-verdict={verdict}>
            <ShieldX className="h-6 w-6 shrink-0 text-red-600" />
            <div>
              <div className="font-am-body font-bold text-red-800">ይህ መታወቂያ ተሰርዟል</div>
              <div className="text-sm text-red-700">
                {registry!.status === "invalid"
                  ? "Revoked ID Card"
                  : `Signature is genuine, but the registry lists this card as ${registry!.status}.`}
              </div>
            </div>
          </div>
        ) : verdict === "not_found" ? (
          <div className="flex items-center gap-3 bg-red-50 px-5 py-4" data-verdict={verdict}>
            <ShieldX className="h-6 w-6 shrink-0 text-red-600" />
            <div>
              <div className="font-am-body font-bold text-red-800">በመዝገቡ ውስጥ አልተገኘም</div>
              <div className="text-sm text-red-700">
                Not recognised by the registry. Do not accept this card; report it to the issuing
                woreda.
              </div>
            </div>
          </div>
        ) : verdict === "not_issued" ? (
          <div className="flex items-center gap-3 bg-amber-50 px-5 py-4" data-verdict={verdict}>
            <Clock className="h-6 w-6 shrink-0 text-amber-600" />
            <div>
              <div className="font-am-body font-bold text-amber-800">ገና አልተሰጠም</div>
              <div className="text-sm text-amber-700">
                This card has been prepared but not yet issued to its holder.
              </div>
            </div>
          </div>
        ) : verdict === "printed_not_collected" ? (
          <div className="flex items-center gap-3 bg-amber-50 px-5 py-4" data-verdict={verdict}>
            <Clock className="h-6 w-6 shrink-0 text-amber-600" />
            <div>
              <div className="font-am-body font-bold text-amber-800">ታትሟል፤ ገና አልተሰጠም</div>
              <div className="text-sm text-amber-700">
                Genuine card, printed but not yet collected by its holder.
              </div>
            </div>
          </div>
        ) : verdict === "expired" ? (
          <div className="flex items-center gap-3 bg-amber-50 px-5 py-4" data-verdict={verdict}>
            <Clock className="h-6 w-6 shrink-0 text-amber-600" />
            <div>
              <div className="font-am-body font-bold text-amber-800">የአገልግሎት ጊዜው አብቅቷል</div>
              <div className="text-sm text-amber-700">Genuine card, but it has expired.</div>
            </div>
          </div>
        ) : verdict === "verified" ? (
          <div className="flex items-center gap-3 bg-emerald-50 px-5 py-4" data-verdict={verdict}>
            <BadgeCheck className="h-6 w-6 shrink-0 text-emerald-600" />
            <div>
              <div className="font-am-body font-bold text-emerald-800">የተረጋገጠ ትክክለኛ መታወቂያ</div>
              <div className="text-sm text-emerald-700">Issued by the Harari Regional State.</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-amber-50 px-5 py-4" data-verdict={verdict}>
            <ShieldAlert className="h-6 w-6 shrink-0 text-amber-600" />
            <div>
              <div className="font-am-body font-bold text-amber-800">
                ትክክለኛ መታወቂያ፤ የአሁኑ ሁኔታው አልታወቀም
              </div>
              <div className="text-sm text-amber-700">
                Authenticity proven, current status unknown. The registry could not be reached, so
                whether this card is still in force cannot be confirmed. Try again shortly.
              </div>
            </div>
          </div>
        )}

        {/* A withdrawn/invalid card reveals nothing beyond the banner above --
            same treatment as a bad signature (t3_03_bare_number.png-style):
            the point of collapsing the status to "invalid" for an anonymous
            caller is to stop a stranger learning WHY a card is invalid, and
            showing the resident's name/woreda/kebele/dates right below that
            banner would leak exactly the identity the collapse was meant to
            protect. */}
        {!hideDetails && (
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
        )}
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        <span className="font-am-body">የሐረሪ ክልላዊ መንግሥት</span> / Harari Regional State
      </p>
    </Shell>
  );
}
