import { createFileRoute, Navigate } from "@tanstack/react-router";

// Settings used to be a single flat page. It is now split into
// /woreda/settings/woreda-configuration and /woreda/settings/users-permissions
// (see src/config/permissions.ts's NAV_PERMISSION_MAP). This bare route stays
// only because the sidebar's tenant logo/name still links to /woreda/settings
// and old bookmarks may point here.
export const Route = createFileRoute("/woreda/settings/")({
  ssr: false,
  component: () => <Navigate to="/woreda/settings/woreda-configuration" replace />,
});
