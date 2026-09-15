/**
 * Amharic-first, plain-language labels for permission keys, per
 * docs/rbac-security-forensic-review.md §3.4 ("name the action a person
 * recognizes doing, never the code's own vocabulary").
 *
 * The eight entries below were the report's own illustrative draft and have
 * since been reviewed and approved by a native Amharic speaker (the system
 * owner) -- they are final copy, not placeholder text.
 *
 * Still deliberately incomplete: only these eight are populated. Generating
 * Amharic for the other ~34 permission keys without the same review risks
 * shipping actively wrong text to the exact Amharic-speaking users this fix
 * exists for -- worse than the English-only label it would replace. Every
 * other key is left absent on purpose; RolesPermissionsTab's existing
 * `PERMISSION_LABELS` (English-only) stays the fallback until a native
 * speaker reviews the rest.
 *
 * DO NOT add a new entry here without the same native-speaker review --
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
