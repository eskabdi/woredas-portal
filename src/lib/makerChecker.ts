// Client mirror of the approval rule enforced by enforce_workflow_transition()
// (migration 107, P1-5): the approver must differ from this cycle's verifier
// and from the requester, and a verification must be on record. The database
// is the authority; this only lets the screen explain why Approve is
// unavailable instead of surfacing a rejected write.

export type ApprovalBlock = "verifier" | "requester" | "unverified";

export function approvalBlock(
  actorUserId: string | null | undefined,
  verifiedBy: string | null | undefined,
  requestedBy: string | null | undefined,
): ApprovalBlock | null {
  if (!actorUserId) return null;
  if (!verifiedBy) return "unverified";
  if (verifiedBy === actorUserId) return "verifier";
  if (requestedBy && requestedBy === actorUserId) return "requester";
  return null;
}

export const APPROVAL_BLOCK_MESSAGE: Record<ApprovalBlock, { am: string; en: string }> = {
  verifier: {
    am: "እርስዎ ራስዎ ያረጋገጡትን ጥያቄ ማጽደቅ አይችሉም",
    en: "You verified this yourself; a different person must approve it (maker ≠ checker).",
  },
  requester: {
    am: "እርስዎ ያቀረቡትን ጥያቄ ማጽደቅ አይችሉም",
    en: "You made this request; a different person must approve it (maker ≠ checker).",
  },
  unverified: {
    am: "ጥያቄው ገና አልተረጋገጠም",
    en: "This has no verification on record yet; it must be verified before approval.",
  },
};
