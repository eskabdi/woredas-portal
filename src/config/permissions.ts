export type Role =
  | "super_admin"
  | "tenant_admin"
  | "civil_registrar"
  | "registry_clerk"
  | "finance_clerk"
  | "supervisor"
  | "auditor"
  | "viewer"
  // A2 (fix-task-production-readiness-v3, Task 4): built-in per the workflow
  // spec's RBAC table. Print/handover duties (Task 10): preview_print,
  // confirm_print, authorize_reprint, activate.
  | "print_officer"
  // D4/A5 (Task 13): a tenant-defined custom role. Carries no compiled
  // default grant set of its own -- ROLE_PERMISSIONS.custom is deliberately
  // [] (A6: custom roles fail closed, no defaults). Its actual grants live
  // in tenant_role_permission, keyed by app_user.custom_role_id, resolved by
  // user_has_perm()/current_permissions() (00000000000039), never by
  // default_role_perms() or role_permission.
  | "custom";

export const P = {
  RESIDENT_CREATE: "resident.create",
  RESIDENT_READ: "resident.read",
  RESIDENT_UPDATE: "resident.update",
  RESIDENT_DELETE: "resident.delete",
  HOUSEHOLD_CREATE: "household.create",
  HOUSEHOLD_READ: "household.read",
  HOUSEHOLD_UPDATE: "household.update",
  CREDENTIAL_ISSUE: "credential.issue",
  CREDENTIAL_READ: "credential.read",
  CREDENTIAL_PRINT: "credential.print",
  CREDENTIAL_VERIFY: "credential.verify",
  // Task 10 (fix-task-production-readiness-v3): tenant_admin only.
  // Previously also compiled into supervisor's default -- removed there so
  // "revocation is tenant_admin only" holds as a real default, not just as
  // an already-reserved key a tenant_admin can no longer reassign via the
  // matrix (RESERVED_PERMISSION_KEYS below already covered the latter).
  CREDENTIAL_REVOKE: "credential.revoke",
  CREDENTIAL_RENEW: "credential.renew",
  CREDENTIAL_APPROVE: "credential.approve",
  // Granular workflow verbs (migration 25, Task 1). `credential.review` is the
  // workflow verification step; `credential.verify` is NOT reused for it because
  // that key already gates the public ID-lookup screen and is held by viewer and
  // auditor on purpose -- see docs/fix-task-v3-execution-notes.md, D-3.
  CREDENTIAL_SUBMIT: "credential.submit",
  CREDENTIAL_REVIEW: "credential.review",
  CREDENTIAL_RESUBMIT: "credential.resubmit",
  CREDENTIAL_RETURN: "credential.return",
  CREDENTIAL_REJECT: "credential.reject",
  CREDENTIAL_RECORD_PAYMENT: "credential.record_payment",
  CREDENTIAL_PREVIEW_PRINT: "credential.preview_print",
  CREDENTIAL_CONFIRM_PRINT: "credential.confirm_print",
  CREDENTIAL_ACTIVATE: "credential.activate",
  CREDENTIAL_SUSPEND: "credential.suspend",
  // Task 4 (fix-task-production-readiness-v3): materialized ahead of Task 9/10's
  // enforcement. CREDENTIAL_VIEW is deliberately distinct from CREDENTIAL_READ --
  // D-3 in docs/fix-task-v3-execution-notes.md already reserved credential.view
  // for the workflow spec's read-only-role RBAC row, separate from the broader
  // coarse credential.read this app already gates most of the credentials module
  // on. Coarse permissions keep working; these are additive, not a replacement.
  CREDENTIAL_CREATE_REQUEST: "credential.create_request",
  CREDENTIAL_AUTHORIZE_REPRINT: "credential.authorize_reprint",
  // Reserved (A4): tenant_admin only, never grantable to another role or via
  // override -- see ROLE_PERMISSIONS' reserved-permission note below.
  CREDENTIAL_CONFIGURE_POLICY: "credential.configure_policy",
  CREDENTIAL_VIEW: "credential.view",
  CIVIL_REGISTER: "civil.register",
  CIVIL_APPROVE: "civil.approve",
  CIVIL_READ: "civil.read",
  // Task 14's granular civil-registration workflow verbs, materialized now
  // (Task 4 item 1) so the default matrix is ready before Task 14 wires the
  // vital_event FSM. civil.register/.approve/.read (coarse) are unchanged and
  // keep gating everything until Task 14 lands.
  CIVIL_CREATE_EVENT: "civil.create_event",
  CIVIL_SUBMIT: "civil.submit",
  CIVIL_RESUBMIT: "civil.resubmit",
  CIVIL_VERIFY: "civil.verify",
  CIVIL_RETURN: "civil.return",
  CIVIL_REJECT: "civil.reject",
  CIVIL_RECORD_PAYMENT: "civil.record_payment",
  CIVIL_VIEW: "civil.view",
  PAYMENT_COLLECT: "payment.collect",
  PAYMENT_READ: "payment.read",
  RECEIPT_PRINT: "receipt.print",
  REPORT_VIEW: "report.view",
  REPORT_EXPORT: "report.export",
  AUDIT_VIEW: "audit.view",
  TENANT_MANAGE: "tenant.manage",
  USER_MANAGE: "user.manage",
  PLATFORM_MANAGE: "platform.manage",
  TENANT_CREATE: "tenant.create",
  RENTAL_VIEW: "rental.view",
  RENTAL_CREATE: "rental.create",
  RENTAL_APPROVE: "rental.approve",
  RENTAL_VACATE: "rental.vacate",
  RENTAL_REPORT: "rental.report",
  // Kebele Rental Houses Management plan, Phase 0: writes to rental_policy
  // (due-date rule, reminder cadence, checkpoint blocking behavior, etc.).
  // Reserved (RESERVED_PERMISSION_KEYS below) -- the same administrative
  // category as credential.configure_policy.
  RENTAL_POLICY_CONFIGURE: "rental.policy.configure",
  // Phase 2 (Financial core): invokes generate_rent_charges() -- an
  // administrative financial action (creates the period's rent charges for
  // every active account in the tenant), not a per-record CRUD verb, so it
  // is scoped like RENTAL_POLICY_CONFIGURE rather than folded into
  // RENTAL_CREATE/RENTAL_APPROVE. Not reserved: unlike RENTAL_POLICY_CONFIGURE
  // this is an ordinary grantable permission a tenant_admin may hand to
  // another role via the matrix (e.g. a finance_clerk) if the tenant wants
  // that.
  RENTAL_BILLING: "rental.billing",
  // Phase 3 (Settlement and payments): rental.collect/.settle are ordinary
  // grantable permissions (same category as RENTAL_BILLING). rental.reverse
  // is RESERVED (RESERVED_PERMISSION_KEYS below) -- reversing money already
  // collected is the same risk class as CREDENTIAL_REVOKE, which is also
  // tenant_admin-only and reserved.
  RENTAL_COLLECT: "rental.collect",
  RENTAL_SETTLE: "rental.settle",
  RENTAL_REVERSE: "rental.reverse",
  REVENUE_VIEW: "revenue.view",
  REVENUE_COLLECT: "revenue.collect",
  REVENUE_RECEIPT_REPRINT: "revenue.receipt_reprint",
  SERVICE_CREATE: "service.create",
  SERVICE_READ: "service.read",
  SERVICE_VERIFY: "service.verify",
  SERVICE_APPROVE: "service.approve",
  SERVICE_ISSUE: "service.issue",
  // Task 14's granular service-request workflow verbs, materialized now
  // (same reasoning as CIVIL_* above). service.create/.read/.verify/.approve/
  // .issue (coarse) are unchanged and keep gating everything until Task 14
  // lands; service.issue_letter is a distinct new terminal verb (paid ->
  // issued), not a rename of service.issue.
  SERVICE_SUBMIT: "service.submit",
  SERVICE_RESUBMIT: "service.resubmit",
  SERVICE_RETURN: "service.return",
  SERVICE_REJECT: "service.reject",
  SERVICE_RECORD_PAYMENT: "service.record_payment",
  SERVICE_ISSUE_LETTER: "service.issue_letter",
  SERVICE_COMPLETE: "service.complete",
  COMPLAINT_MANAGE: "complaint.manage",
  APPROVAL_QUEUE_VIEW: "approval.queue.view",
} as const;

export type Permission = (typeof P)[keyof typeof P];

// Console permissions are a second, separate dimension scoped to the Super
// Admin Console itself (see console_role / console_role_permission /
// user_has_console_perm() in 00000000000009_console_roles.sql). These keys
// must match that migration's CHECK constraint exactly.
export const CP = {
  TENANTS_MANAGE: "console.tenants.manage",
  USERS_MANAGE: "console.users.manage",
  AUDIT_VIEW: "console.audit.view",
  CREDENTIAL_TEMPLATE_MANAGE: "console.credential_template.manage",
  CONSOLE_USERS_MANAGE: "console.console_users.manage",
} as const;

export type ConsolePermission = (typeof CP)[keyof typeof CP];

// Reserved (A4, fix-task-production-readiness-v3 Task 13): platform.manage,
// tenant.create, tenant.manage, user.manage, credential.approve, civil.approve,
// credential.revoke, credential.configure_policy -- administrative/approval
// powers that must never become grantable to a different role or user than
// their compiled default via the matrix, an override, or a custom tenant_role,
// no matter which role's default_role_perms() already includes them. Enforced
// server-side: role_permission's INSERT/UPDATE policies, user_permission_override's
// CHECK constraint, and tenant_role_permission's CHECK constraint all exclude
// this exact list (00000000000021, 00000000000036, 00000000000037,
// 00000000000038, 00000000000071); this comment and RESERVED_PERMISSION_KEYS
// below are documentation, not the enforcement itself -- keep both in sync
// with those constraints by hand. rental.policy.configure (Kebele Rental
// Houses plan, Phase 0) joined the list in 00000000000071.
export const RESERVED_PERMISSION_KEYS: Permission[] = [
  P.PLATFORM_MANAGE,
  P.TENANT_CREATE,
  P.TENANT_MANAGE,
  P.USER_MANAGE,
  P.CREDENTIAL_APPROVE,
  P.CIVIL_APPROVE,
  P.CREDENTIAL_REVOKE,
  P.CREDENTIAL_CONFIGURE_POLICY,
  P.RENTAL_POLICY_CONFIGURE,
  P.RENTAL_REVERSE,
];
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    P.PLATFORM_MANAGE,
    P.TENANT_CREATE,
    P.TENANT_MANAGE,
    P.USER_MANAGE,
    P.AUDIT_VIEW,
    P.REPORT_VIEW,
  ],
  tenant_admin: [
    P.RESIDENT_CREATE,
    P.RESIDENT_READ,
    P.RESIDENT_UPDATE,
    P.RESIDENT_DELETE,
    P.HOUSEHOLD_CREATE,
    P.HOUSEHOLD_READ,
    P.HOUSEHOLD_UPDATE,
    P.CREDENTIAL_ISSUE,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_PRINT,
    P.CREDENTIAL_VERIFY,
    P.CREDENTIAL_REVOKE,
    P.CREDENTIAL_RENEW,
    P.CREDENTIAL_APPROVE,
    P.CIVIL_REGISTER,
    P.CIVIL_APPROVE,
    P.CIVIL_READ,
    P.PAYMENT_COLLECT,
    P.PAYMENT_READ,
    P.RECEIPT_PRINT,
    P.REPORT_VIEW,
    P.REPORT_EXPORT,
    P.AUDIT_VIEW,
    P.TENANT_MANAGE,
    P.USER_MANAGE,
    P.RENTAL_VIEW,
    P.RENTAL_CREATE,
    P.RENTAL_APPROVE,
    P.RENTAL_VACATE,
    P.RENTAL_REPORT,
    P.REVENUE_VIEW,
    P.REVENUE_COLLECT,
    P.REVENUE_RECEIPT_REPRINT,
    P.SERVICE_CREATE,
    P.SERVICE_READ,
    P.SERVICE_VERIFY,
    P.SERVICE_APPROVE,
    P.SERVICE_ISSUE,
    P.COMPLAINT_MANAGE,
    P.APPROVAL_QUEUE_VIEW,
    P.CREDENTIAL_SUBMIT,
    P.CREDENTIAL_REVIEW,
    P.CREDENTIAL_RESUBMIT,
    P.CREDENTIAL_RETURN,
    P.CREDENTIAL_REJECT,
    P.CREDENTIAL_RECORD_PAYMENT,
    P.CREDENTIAL_CONFIRM_PRINT,
    P.CREDENTIAL_ACTIVATE,
    P.CREDENTIAL_SUSPEND,
    P.CREDENTIAL_PREVIEW_PRINT,
    P.CREDENTIAL_CREATE_REQUEST,
    P.CREDENTIAL_AUTHORIZE_REPRINT,
    P.CREDENTIAL_CONFIGURE_POLICY,
    P.CREDENTIAL_VIEW,
    P.CIVIL_CREATE_EVENT,
    P.CIVIL_SUBMIT,
    P.CIVIL_RESUBMIT,
    P.CIVIL_VERIFY,
    P.CIVIL_RETURN,
    P.CIVIL_REJECT,
    P.CIVIL_RECORD_PAYMENT,
    P.CIVIL_VIEW,
    P.SERVICE_SUBMIT,
    P.SERVICE_RESUBMIT,
    P.SERVICE_RETURN,
    P.SERVICE_REJECT,
    P.SERVICE_RECORD_PAYMENT,
    P.SERVICE_ISSUE_LETTER,
    P.SERVICE_COMPLETE,
    P.RENTAL_POLICY_CONFIGURE,
    P.RENTAL_BILLING,
    P.RENTAL_COLLECT,
    P.RENTAL_SETTLE,
    P.RENTAL_REVERSE,
  ],
  supervisor: [
    P.RESIDENT_READ,
    P.HOUSEHOLD_READ,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_VERIFY,
    P.CREDENTIAL_APPROVE,
    P.CIVIL_APPROVE,
    P.CIVIL_READ,
    P.PAYMENT_READ,
    P.RECEIPT_PRINT,
    P.REPORT_VIEW,
    P.REPORT_EXPORT,
    P.AUDIT_VIEW,
    P.RENTAL_VIEW,
    P.RENTAL_APPROVE,
    P.REVENUE_VIEW,
    P.REVENUE_RECEIPT_REPRINT,
    P.SERVICE_READ,
    P.SERVICE_VERIFY,
    P.SERVICE_APPROVE,
    P.COMPLAINT_MANAGE,
    P.APPROVAL_QUEUE_VIEW,
    P.CREDENTIAL_RETURN,
    P.CREDENTIAL_REJECT,
    P.CREDENTIAL_SUSPEND,
    P.CREDENTIAL_AUTHORIZE_REPRINT,
    P.CREDENTIAL_VIEW,
    P.CIVIL_REJECT,
    P.CIVIL_VIEW,
    P.SERVICE_REJECT,
  ],
  civil_registrar: [
    P.RESIDENT_CREATE,
    P.RESIDENT_READ,
    P.RESIDENT_UPDATE,
    P.HOUSEHOLD_READ,
    P.CREDENTIAL_ISSUE,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_PRINT,
    P.CREDENTIAL_VERIFY,
    P.CIVIL_REGISTER,
    P.CIVIL_READ,
    P.SERVICE_CREATE,
    P.SERVICE_READ,
    P.SERVICE_ISSUE,
    P.APPROVAL_QUEUE_VIEW,
    P.CREDENTIAL_SUBMIT,
    P.CREDENTIAL_REVIEW,
    P.CREDENTIAL_RESUBMIT,
    P.CREDENTIAL_RETURN,
    P.CREDENTIAL_CONFIRM_PRINT,
    P.CREDENTIAL_ACTIVATE,
    P.CREDENTIAL_PREVIEW_PRINT,
    P.CREDENTIAL_CREATE_REQUEST,
    P.CREDENTIAL_VIEW,
    P.CIVIL_CREATE_EVENT,
    P.CIVIL_SUBMIT,
    P.CIVIL_RESUBMIT,
    P.CIVIL_VERIFY,
    P.CIVIL_RETURN,
    P.CIVIL_VIEW,
    P.SERVICE_SUBMIT,
    P.SERVICE_RESUBMIT,
    P.SERVICE_VERIFY,
    P.SERVICE_RETURN,
    P.SERVICE_ISSUE_LETTER,
    P.SERVICE_COMPLETE,
  ],
  registry_clerk: [
    P.RESIDENT_CREATE,
    P.RESIDENT_READ,
    P.RESIDENT_UPDATE,
    P.HOUSEHOLD_CREATE,
    P.HOUSEHOLD_READ,
    P.HOUSEHOLD_UPDATE,
    P.CREDENTIAL_ISSUE,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_PRINT,
    P.CREDENTIAL_VERIFY,
    P.CIVIL_READ,
    P.RENTAL_VIEW,
    P.RENTAL_CREATE,
    P.RENTAL_COLLECT,
    P.SERVICE_CREATE,
    P.SERVICE_READ,
    P.SERVICE_ISSUE,
    P.COMPLAINT_MANAGE,
    P.APPROVAL_QUEUE_VIEW,
    P.CREDENTIAL_SUBMIT,
    P.CREDENTIAL_REVIEW,
    P.CREDENTIAL_RESUBMIT,
    P.CREDENTIAL_RETURN,
    P.CREDENTIAL_CONFIRM_PRINT,
    P.CREDENTIAL_ACTIVATE,
    P.CREDENTIAL_PREVIEW_PRINT,
    P.CREDENTIAL_CREATE_REQUEST,
    P.CREDENTIAL_VIEW,
    P.CIVIL_CREATE_EVENT,
    P.CIVIL_SUBMIT,
    P.CIVIL_RESUBMIT,
    P.CIVIL_VERIFY,
    P.CIVIL_RETURN,
    P.CIVIL_VIEW,
    P.SERVICE_SUBMIT,
    P.SERVICE_RESUBMIT,
    P.SERVICE_VERIFY,
    P.SERVICE_RETURN,
    P.SERVICE_ISSUE_LETTER,
    P.SERVICE_COMPLETE,
  ],
  finance_clerk: [
    P.PAYMENT_COLLECT,
    P.PAYMENT_READ,
    P.RECEIPT_PRINT,
    P.RESIDENT_READ,
    P.HOUSEHOLD_READ,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_VERIFY,
    P.REVENUE_VIEW,
    P.REVENUE_COLLECT,
    P.REVENUE_RECEIPT_REPRINT,
    P.SERVICE_READ,
    P.APPROVAL_QUEUE_VIEW,
    P.CREDENTIAL_RECORD_PAYMENT,
    P.CREDENTIAL_VIEW,
    P.CIVIL_VIEW,
    P.CIVIL_RECORD_PAYMENT,
    P.SERVICE_RECORD_PAYMENT,
    P.RENTAL_VIEW,
    P.RENTAL_COLLECT,
    P.RENTAL_SETTLE,
  ],
  auditor: [
    P.RESIDENT_READ,
    P.HOUSEHOLD_READ,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_VERIFY,
    P.CIVIL_READ,
    P.PAYMENT_READ,
    P.REPORT_VIEW,
    P.AUDIT_VIEW,
    P.RENTAL_VIEW,
    P.RENTAL_REPORT,
    P.REVENUE_VIEW,
    P.SERVICE_READ,
    P.CREDENTIAL_VIEW,
    P.CIVIL_VIEW,
  ],
  viewer: [
    P.RESIDENT_READ,
    P.HOUSEHOLD_READ,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_VERIFY,
    P.CIVIL_READ,
    P.PAYMENT_READ,
    P.SERVICE_READ,
    P.CREDENTIAL_VIEW,
    P.CIVIL_VIEW,
  ],
  // A2: built-in per the workflow spec's RBAC table. Print/handover stage
  // duties only -- exact grant set inferred from Task 1/10's role
  // descriptions since ID Card Workflow.txt (the spec's own binding
  // reference) isn't in this repo; adjustable per-tenant via the matrix (A3)
  // like any other built-in role.
  print_officer: [
    P.CREDENTIAL_READ,
    P.CREDENTIAL_VIEW,
    P.CREDENTIAL_PREVIEW_PRINT,
    P.CREDENTIAL_CONFIRM_PRINT,
    P.CREDENTIAL_AUTHORIZE_REPRINT,
    P.CREDENTIAL_ACTIVATE,
    P.APPROVAL_QUEUE_VIEW,
  ],
  // D4/A5 (Task 13): no compiled default -- see the Role type's own comment.
  custom: [],
};

export type ModuleKey =
  | "credentials"
  | "civil_registration"
  | "revenue"
  | "reports"
  | "audit"
  | "rental_houses"
  | "services"
  | "approvals";

export interface NavItem {
  labelAm: string;
  labelEn: string;
  icon: string;
  href: string;
  permission: Permission | null;
  moduleKey?: ModuleKey;
}

export const NAV_PERMISSION_MAP: NavItem[] = [
  {
    labelAm: "ዳሽቦርድ",
    labelEn: "Dashboard",
    icon: "LayoutDashboard",
    href: "/woreda/dashboard",
    permission: null,
  },
  {
    labelAm: "ነዋሪዎች",
    labelEn: "Residents",
    icon: "Users",
    href: "/woreda/residents",
    permission: P.RESIDENT_READ,
  },
  {
    labelAm: "ቤተሰቦች",
    labelEn: "Households",
    icon: "Home",
    href: "/woreda/households",
    permission: P.HOUSEHOLD_READ,
  },
  {
    labelAm: "የነዋሪ መታወቂያ",
    labelEn: "Credentials",
    icon: "CreditCard",
    href: "/woreda/credentials",
    permission: P.CREDENTIAL_READ,
    moduleKey: "credentials",
  },
  {
    labelAm: "መታወቂያ ያረጋግጡ",
    labelEn: "Verify ID",
    icon: "ShieldCheck",
    href: "/woreda/credentials/verify",
    permission: P.CREDENTIAL_VERIFY,
  },
  {
    labelAm: "የኩነት ምዝገባ",
    labelEn: "Civil Registration",
    icon: "FileText",
    href: "/woreda/civil",
    permission: P.CIVIL_READ,
    moduleKey: "civil_registration",
  },
  {
    labelAm: "የቀበሌ የኪራይ ቤቶች",
    labelEn: "Kebele Rental Houses",
    icon: "Building2",
    href: "/woreda/rental-houses",
    permission: P.RENTAL_VIEW,
  },
  {
    labelAm: "አገልግሎት ጥያቄዎች",
    labelEn: "Service Requests",
    icon: "MailQuestion",
    href: "/woreda/services",
    permission: P.SERVICE_READ,
    moduleKey: "services",
  },
  {
    labelAm: "ቅሬታዎች",
    labelEn: "Complaints",
    icon: "MessageSquareWarning",
    href: "/woreda/complaints",
    permission: P.SERVICE_READ,
    moduleKey: "services",
  },
  {
    labelAm: "የማጽደቅ ወረፋ",
    labelEn: "Approval Queue",
    icon: "Inbox",
    href: "/woreda/approvals",
    permission: P.APPROVAL_QUEUE_VIEW,
    moduleKey: "approvals",
  },
  {
    labelAm: "ገቢ",
    labelEn: "Revenue",
    icon: "Banknote",
    href: "/woreda/revenue",
    permission: P.REVENUE_VIEW,
    moduleKey: "revenue",
  },
  {
    labelAm: "ሪፖርቶች",
    labelEn: "Reports",
    icon: "BarChart3",
    href: "/woreda/reports",
    permission: P.REPORT_VIEW,
    moduleKey: "reports",
  },
  {
    labelAm: "ኦዲት",
    labelEn: "Audit Trail",
    icon: "ScrollText",
    href: "/woreda/audit",
    permission: P.AUDIT_VIEW,
    moduleKey: "audit",
  },
  {
    labelAm: "የወረዳ ውቅር",
    labelEn: "Woreda Configuration",
    icon: "Settings",
    href: "/woreda/settings/woreda-configuration",
    permission: P.TENANT_MANAGE,
  },
  {
    labelAm: "ተጠቃሚዎች እና ፈቃዶች",
    labelEn: "Users and Permissions",
    icon: "UserCog",
    href: "/woreda/settings/users-permissions",
    permission: P.TENANT_MANAGE,
  },
];

export interface AdminNavItem {
  label: string;
  icon: string;
  href: string;
  /** null = always visible; an array is satisfied by any one permission. */
  consolePermission: ConsolePermission | ConsolePermission[] | null;
}

export const ADMIN_NAV: AdminNavItem[] = [
  {
    label: "Dashboard",
    icon: "LayoutDashboard",
    href: "/admin/dashboard",
    consolePermission: null,
  },
  {
    label: "Tenants",
    icon: "Building2",
    href: "/admin/tenants",
    consolePermission: [CP.TENANTS_MANAGE, CP.USERS_MANAGE],
  },
  {
    label: "ID Card Template",
    icon: "CreditCard",
    href: "/admin/credential-template",
    consolePermission: CP.CREDENTIAL_TEMPLATE_MANAGE,
  },
  {
    label: "Audit Logs",
    icon: "ScrollText",
    href: "/admin/audit",
    consolePermission: CP.AUDIT_VIEW,
  },
  {
    label: "Console Users and Role",
    icon: "Users",
    href: "/admin/console-roles",
    consolePermission: CP.CONSOLE_USERS_MANAGE,
  },
];
