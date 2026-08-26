import { createFileRoute } from "@tanstack/react-router";
import { ModuleGate } from "@/components/common/ModuleGate";

// Thin layout, mirroring woreda.credentials.tsx: ModuleGate with no explicit
// children defaults to rendering <Outlet/> (see ModuleGate.tsx), which is
// what actually mounts woreda.revenue.index.tsx (the list) and
// woreda.revenue.$paymentId.receipt.tsx (the print route) as children of
// this route. Before this file existed as a layout, the list page WAS this
// route's component with no <Outlet/> anywhere in its tree -- the print
// route matched in the router but had nowhere to render, so it silently
// showed the revenue list instead of the receipt.
export const Route = createFileRoute("/woreda/revenue")({
  ssr: false,
  component: () => <ModuleGate moduleKey="revenue" />,
});
