import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { ModuleGate } from "@/components/common/ModuleGate";

export const Route = createFileRoute("/woreda/credentials")({
  ssr: false,
  component: CredentialsLayout,
});

function CredentialsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Verification is cross-cutting and must NOT be gated by the Credentials module toggle.
  if (pathname.startsWith("/woreda/credentials/verify")) {
    return <Outlet />;
  }
  return <ModuleGate moduleKey="credentials" />;
}
