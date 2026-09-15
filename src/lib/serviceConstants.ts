/** Shared labels & workflow helpers for the Service Requests / Complaints module. */

export type ServiceCategory = "letter" | "complaint";

export const SERVICE_STATUS_LABEL: Record<string, string> = {
  draft: "ረቂቅ / Draft",
  submitted: "ገብቷል / Submitted",
  under_review: "በክለሳ ላይ / Under review",
  verified: "ተረጋግጧል / Verified",
  returned: "ተመልሷል / Returned",
  pending_approval: "ጸድቆ በሚጠበቅ / Pending approval",
  approval_returned: "ተመልሷል (ማጽደቅ) / Returned (approval)",
  approved: "ፀድቋል / Approved",
  rejected: "ውድቅ ተደርጓል / Rejected",
  awaiting_payment: "ክፍያ በጥበቃ / Awaiting payment",
  paid: "ተከፍሏል / Paid",
  issued: "ተሰጥቷል / Issued",
  completed: "ተጠናቋል / Completed",
  in_progress: "በሂደት ላይ / In progress",
  resolved: "ተፈትቷል / Resolved",
  closed: "ተዘግቷል / Closed",
};

export const PRIORITY_LABEL: Record<string, string> = {
  low: "ዝቅተኛ / Low",
  normal: "መደበኛ / Normal",
  high: "ከፍተኛ / High",
  urgent: "አስቸኳይ / Urgent",
};

export const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-slate-100 text-slate-700",
  high: "bg-amber-100 text-amber-800",
  urgent: "bg-red-100 text-red-800",
};

export const LETTER_STATUS_OPTIONS = [
  "all",
  "submitted",
  "under_review",
  "verified",
  "returned",
  "pending_approval",
  "approved",
  "awaiting_payment",
  "paid",
  "issued",
  "completed",
  "rejected",
] as const;

export const COMPLAINT_STATUS_OPTIONS = [
  "all",
  "submitted",
  "under_review",
  "returned",
  "pending_approval",
  "approval_returned",
  "approved",
  "in_progress",
  "resolved",
  "rejected",
  "closed",
] as const;

/** Stages that are still awaiting staff action (used by the approval queue). */
export const OPEN_SERVICE_STATUSES = [
  "submitted",
  "under_review",
  "pending_approval",
  "awaiting_payment",
  "returned",
  "approval_returned",
  "in_progress",
];

export const DOCUMENT_TYPES: { value: string; labelAm: string; labelEn: string }[] = [
  { value: "id_copy", labelAm: "የመታወቂያ ኮፒ", labelEn: "ID copy" },
  { value: "support_letter", labelAm: "የድጋፍ ደብዳቤ", labelEn: "Support letter" },
  { value: "evidence", labelAm: "ማስረጃ", labelEn: "Evidence" },
  { value: "other", labelAm: "ሌላ", labelEn: "Other" },
];

export const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function serviceStatusLabel(status: string) {
  return SERVICE_STATUS_LABEL[status] ?? status;
}

/** Ordered workflow stages for the stepper. */
export function stageIndex(status: string, category: ServiceCategory) {
  const letter = [
    "submitted",
    "under_review",
    "verified",
    "pending_approval",
    "approved",
    "awaiting_payment",
    "paid",
    "issued",
    "completed",
  ];
  const complaint = [
    "submitted",
    "under_review",
    "pending_approval",
    "approved",
    "in_progress",
    "resolved",
  ];
  const flow = category === "complaint" ? complaint : letter;
  const normalized =
    status === "returned" || status === "approval_returned"
      ? "under_review"
      : status === "closed"
        ? flow[flow.length - 1]!
        : status;
  const i = flow.indexOf(normalized);
  return { flow, index: i };
}
