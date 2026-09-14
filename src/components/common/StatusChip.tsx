interface StatusChipProps {
  status: string;
  showAmharic?: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  returned: "bg-amber-100 text-amber-800",
  approval_returned: "bg-amber-100 text-amber-800",
  expired: "bg-gray-100 text-gray-600",
  revoked: "bg-red-100 text-red-800",

  draft: "bg-slate-100 text-slate-600",
  // Credential workflow stages. Colours follow the spec's chip map
  // (docs/id-card-workflow.txt:580-601); `printed` keeps the purple it already
  // shipped with rather than being restyled underneath existing screens.
  submitted: "bg-blue-100 text-blue-800",
  under_review: "bg-blue-100 text-blue-800",
  verified: "bg-teal-100 text-teal-800",
  awaiting_payment: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
  // Task 14-A: vital_event's own terminal success state (paid -> registered,
  // system-driven) -- distinct from credential's `active`/`issued` chips
  // since it's a different entity's own terminal, styled the same emerald
  // success tone.
  registered: "bg-emerald-100 text-emerald-800",
  ready_to_print: "bg-indigo-100 text-indigo-800",
  printing: "bg-indigo-100 text-indigo-800",
  printed: "bg-purple-100 text-purple-800",
  confirmed: "bg-green-100 text-green-800",
  suspended: "bg-orange-100 text-orange-800",
  replaced: "bg-gray-100 text-gray-500",
  inactive: "bg-slate-100 text-slate-500",
  reversed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500",

  // Task 14-C: service_request's own extra stages, folded in here so this
  // is the single chip constant across credential/civil/service surfaces
  // (queue, detail, timeline, print log) instead of duplicating a second
  // color/label map in src/lib/serviceConstants.ts.
  issued: "bg-green-100 text-green-800",
  completed: "bg-emerald-100 text-emerald-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-slate-100 text-slate-500",
};

const STATUS_LABELS_AM: Record<string, string> = {
  active: "ንቁ",
  pending: "በጥበቃ",
  pending_approval: "ጸድቆ በሚጠበቅ",
  approved: "ፀድቋል",
  rejected: "ውድቅ ተደርጓል",
  returned: "ተመልሷል",
  approval_returned: "ተመልሷል (ማጽደቅ)",
  expired: "ጊዜው አልፏል",
  revoked: "ተሽሯል",
  draft: "ረቂቅ",
  // Amharic taken verbatim from the reviewed bilingual filter labels in
  // woreda.credentials.index.tsx, except `printing` ("በህትመት ላይ"), which is new
  // for the two-phase print step and was approved by the system owner
  // (native speaker) on 2026-09-07. `ready_to_print` reuses the string already
  // shipping in woreda.reports.$reportType.print.tsx:172.
  submitted: "ገብቷል",
  under_review: "በክለሳ ላይ",
  verified: "ተረጋግጧል",
  awaiting_payment: "ክፍያ በጥበቃ",
  paid: "ተከፍሏል",
  registered: "ተመዝግቧል",
  ready_to_print: "ለህትመት ዝግጁ",
  printing: "በህትመት ላይ",
  printed: "ታትሟል",
  confirmed: "ተረጋግጧል",
  suspended: "ታግዷል",
  replaced: "ተተክቷል",
  inactive: "ቦዝኗል",
  reversed: "ተመልሷል",
  cancelled: "ተሰርዟል",

  issued: "ተሰጥቷል",
  completed: "ተጠናቋል",
  in_progress: "በሂደት ላይ",
  resolved: "ተፈትቷል",
  closed: "ተዘግቷል",
};

/** The Amharic label this chip would render for a status -- exported so
 * non-chip contexts (a plain-text status filter option, an export column)
 * stay in sync with the same single source instead of re-deriving their
 * own label map. */
export function statusLabelAm(status: string): string {
  return STATUS_LABELS_AM[status] ?? status;
}

export function StatusChip({ status, showAmharic = true }: StatusChipProps) {
  const style = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600";
  const label = showAmharic ? (STATUS_LABELS_AM[status] ?? status) : status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style} ${
        showAmharic ? "font-noto-ethiopic" : ""
      }`}
    >
      {label}
    </span>
  );
}
