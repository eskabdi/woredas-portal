import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { PermissionGate } from "@/components/common/PermissionGate";
import { HararildScanner } from "@/components/verification/HararildScanner";
import { P } from "@/config/permissions";

export const Route = createFileRoute("/woreda/credentials/verify")({
  ssr: false,
  component: VerifyPage,
});

function VerifyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        titleAm="የማንነት መታወቂያ ማረጋገጫ"
        titleEn="Credential Verification"
      />
      <PermissionGate
        permission={P.CREDENTIAL_VERIFY}
        fallback={
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            You do not have permission to verify credentials.
          </div>
        }
      >
        <HararildScanner />
      </PermissionGate>
    </div>
  );
}
