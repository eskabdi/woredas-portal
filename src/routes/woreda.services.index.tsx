import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { ServiceRequestList } from "@/components/services/ServiceRequestList";
import { ServiceKpiWidgetRow } from "@/components/services/ServiceKpiWidgetRow";

export const Route = createFileRoute("/woreda/services/")({
  ssr: false,
  component: ServiceRequestsPage,
});

function ServiceRequestsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (!hasPermission(P.SERVICE_READ)) return <Navigate to="/woreda/dashboard" />;
  return (
    <div className="space-y-6">
      <ServiceKpiWidgetRow />
      <ServiceRequestList
        category="letter"
        titleAm="የአገልግሎት ጥያቄዎች"
        titleEn="Service Requests"
        descriptionAm="የነዋሪዎች የደብዳቤና የማረጃ ጥያቄዎች መዝገብ"
      />
    </div>
  );
}
