import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { ServiceRequestList } from "@/components/services/ServiceRequestList";

export const Route = createFileRoute("/woreda/services/")({
  ssr: false,
  component: ServiceRequestsPage,
});

function ServiceRequestsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (!hasPermission(P.SERVICE_READ)) return <Navigate to="/woreda/dashboard" />;
  return (
    <ServiceRequestList
      category="letter"
      titleAm="የአገልግሎት ጥያቄዎች"
      titleEn="Service Requests"
      descriptionAm="የነዋሪዎች የደብዳቤና የማረጃ ጥያቄዎች መዝገብ"
    />
  );
}
