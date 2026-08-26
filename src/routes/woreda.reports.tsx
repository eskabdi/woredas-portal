import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/woreda/reports")({
  ssr: false,
  component: () => <Outlet />,
});
