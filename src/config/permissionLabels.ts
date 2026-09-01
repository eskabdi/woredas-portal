/**
 * Amharic-first, plain-language labels for permission keys, per
 * docs/rbac-security-forensic-review.md §3.4 ("name the action a person
 * recognizes doing, never the code's own vocabulary").
 *
 * Deliberately incomplete: the report is explicit that even its own eight
 * example entries are "illustrative -- written for this review, not by a
 * native speaker -- and must be reviewed by one before any of it ships."
 * Only those eight, copied verbatim, are populated here. Generating Amharic
 * for the other ~34 permission keys myself, with no one able to check it,
 * risks shipping actively wrong text to the exact Amharic-speaking users
 * this fix exists for -- worse than the English-only label it would replace.
 * Every other key is left absent on purpose; RolesPermissionsTab's existing
 * `PERMISSION_LABELS` (English-only) stays the fallback until a native
 * speaker fills the rest in.
 *
 * DO NOT add an entry here without native-speaker review of the Amharic --
 * that includes tone and register, not just literal correctness.
 */
export interface PermissionLabel {
  am: string;
  en: string;
}

export const PERMISSION_ACTION_LABELS: Record<string, PermissionLabel> = {
  "resident.create": { am: "አዲስ ነዋሪ መመዝገብ", en: "Register a new resident" },
  "resident.delete": { am: "የነዋሪ መዝገብ ማጥፋት", en: "Delete a resident's record" },
  "credential.issue": { am: "የመታወቂያ ካርድ ማውጣት", en: "Issue an ID card" },
  "credential.approve": { am: "የመታወቂያ ጥያቄ ማጽደቅ", en: "Approve a credential request" },
  "civil.register": { am: "የልደት/ሞት/ጋብቻ ምዝገባ መመዝገብ", en: "Record a birth, death, or marriage" },
  "payment.collect": { am: "ክፍያ መቀበል", en: "Collect a payment" },
  "rental.approve": { am: "የኪራይ ቤት ጥያቄ ማጽደቅ", en: "Approve a rental house request" },
  "approval.queue.view": { am: "የማጽደቅ ወረፋ ማየት", en: "View the approval queue" },
};
