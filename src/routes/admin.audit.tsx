import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/common/ComingSoon";

export const Route = createFileRoute("/admin/audit")({
  ssr: false,
  component: () => <ComingSoon titleAm="ኦዲት መዝገብ" titleEn="Audit Logs" />,
});
