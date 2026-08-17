import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/woreda/households")({
  ssr: false,
  component: () => <Outlet />,
});
