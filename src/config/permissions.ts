export type Role =
  | "super_admin"
  | "tenant_admin"
  | "civil_registrar"
  | "registry_clerk"
  | "finance_clerk"
  | "supervisor"
  | "auditor"
  | "viewer";

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
  CREDENTIAL_REVOKE: "credential.revoke",
  CREDENTIAL_RENEW: "credential.renew",
  CREDENTIAL_APPROVE: "credential.approve",
  CIVIL_REGISTER: "civil.register",
  CIVIL_APPROVE: "civil.approve",
  CIVIL_READ: "civil.read",
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
  REVENUE_VIEW: "revenue.view",
  REVENUE_COLLECT: "revenue.collect",
  REVENUE_RECEIPT_REPRINT: "revenue.receipt_reprint",
  SERVICE_CREATE: "service.create",
  SERVICE_READ: "service.read",
  SERVICE_VERIFY: "service.verify",
  SERVICE_APPROVE: "service.approve",
  SERVICE_ISSUE: "service.issue",
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
  ],
  supervisor: [
    P.RESIDENT_READ,
    P.HOUSEHOLD_READ,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_VERIFY,
    P.CREDENTIAL_REVOKE,
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
    P.SERVICE_CREATE,
    P.SERVICE_READ,
    P.SERVICE_ISSUE,
    P.COMPLAINT_MANAGE,
    P.APPROVAL_QUEUE_VIEW,
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
  ],
  viewer: [
    P.RESIDENT_READ,
    P.HOUSEHOLD_READ,
    P.CREDENTIAL_READ,
    P.CREDENTIAL_VERIFY,
    P.CIVIL_READ,
    P.PAYMENT_READ,
    P.SERVICE_READ,
  ],
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
    labelAm: "ቅንብሮች",
    labelEn: "Settings",
    icon: "Settings",
    href: "/woreda/settings",
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
