import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { ModuleGate } from "@/components/common/ModuleGate";
import { ServiceRequestList } from "@/components/services/ServiceRequestList";

export const Route = createFileRoute("/woreda/complaints")({
  ssr: false,
  component: ComplaintsPage,
});

function ComplaintsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (!hasPermission(P.SERVICE_READ)) return <Navigate to="/woreda/dashboard" />;
  return (
    <ModuleGate moduleKey="services">
      <ServiceRequestList
        category="complaint"
        titleAm="የነዋሪዎች ቅሬታዎች"
        titleEn="Citizen Complaints"
        descriptionAm="የቀረቡ ቅሬታዎችና የመፍትሔ ሂደታቸው"
      />
    </ModuleGate>
  );
}
