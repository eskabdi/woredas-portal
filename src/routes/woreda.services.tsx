import { createFileRoute } from "@tanstack/react-router";
import { ModuleGate } from "@/components/common/ModuleGate";

export const Route = createFileRoute("/woreda/services")({
  ssr: false,
  component: () => <ModuleGate moduleKey="services" />,
});
