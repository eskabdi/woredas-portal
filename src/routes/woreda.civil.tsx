import { createFileRoute } from "@tanstack/react-router";
import { ModuleGate } from "@/components/common/ModuleGate";

export const Route = createFileRoute("/woreda/civil")({
  ssr: false,
  component: () => <ModuleGate moduleKey="civil_registration" />,
});
