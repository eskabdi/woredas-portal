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
        backHref="/woreda/credentials"
      />
      <PermissionGate
        permission={P.CREDENTIAL_VERIFY}
        fallback={
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
            <p className="font-am-body font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
            <p className="text-sm">You do not have permission to verify credentials.</p>
          </div>
        }
      >
        <HararildScanner />
      </PermissionGate>
    </div>
  );
}
