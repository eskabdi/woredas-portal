import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/woreda/residents")({
  ssr: false,
  component: () => <Outlet />,
});
