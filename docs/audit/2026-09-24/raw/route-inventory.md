| File | URL | ssr:false | Guards (PermissionGate / ConsolePermissionGate / ModuleGate) | Portal |
|---|---|---|---|---|
| `__root.tsx` | `(root)` | NO | — | public |
| `admin.audit.tsx` | `/admin/audit` | yes | CP.AUDIT_VIEW | admin |
| `admin.console-roles.tsx` | `/admin/console-roles` | yes | CP.CONSOLE_USERS_MANAGE | admin |
| `admin.credential-template.tsx` | `/admin/credential-template` | yes | — | admin |
| `admin.dashboard.tsx` | `/admin/dashboard` | yes | — | admin |
| `admin.tenants.$woredaId.index.tsx` | `/admin/tenants/$woredaId/` | yes | CP.TENANTS_MANAGE | admin |
| `admin.tenants.$woredaId.provision.tsx` | `/admin/tenants/$woredaId/provision` | yes | CP.TENANTS_MANAGE | admin |
| `admin.tenants.index.tsx` | `/admin/tenants/` | yes | — | admin |
| `admin.tsx` | `/admin` | yes | — | admin |
| `index.tsx` | `/` | yes | — | public |
| `login.tsx` | `/login` | yes | — | public |
| `set-password.tsx` | `/set-password` | yes | — | public |
| `v.$token.tsx` | `/v/$token` | yes | — | public |
| `verify.letter.$token.tsx` | `/verify/letter/$token` | yes | — | public |
| `verify.receipt.$token.tsx` | `/verify/receipt/$token` | yes | — | public |
| `woreda.approvals.tsx` | `/woreda/approvals` | yes | Module:approvals | woreda |
| `woreda.audit.tsx` | `/woreda/audit` | yes | Module:audit | woreda |
| `woreda.civil.$eventId.tsx` | `/woreda/civil/$eventId` | yes | P.CIVIL_APPROVE, P.CIVIL_READ, P.CIVIL_RECORD_PAYMENT, P.CIVIL_RESUBMIT, P.CIVIL_VERIFY | woreda |
| `woreda.civil.birth.new.tsx` | `/woreda/civil/birth/new` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.death.new.tsx` | `/woreda/civil/death/new` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.divorce.new.tsx` | `/woreda/civil/divorce/new` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.index.tsx` | `/woreda/civil/` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.marriage.new.tsx` | `/woreda/civil/marriage/new` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.tsx` | `/woreda/civil` | yes | Module:civil_registration | woreda |
| `woreda.complaints.tsx` | `/woreda/complaints` | yes | Module:services | woreda |
| `woreda.credentials.$requestId.certificate.tsx` | `/woreda/credentials/$requestId/certificate` | yes | P.CREDENTIAL_PREVIEW_PRINT | woreda |
| `woreda.credentials.$requestId.index.tsx` | `/woreda/credentials/$requestId/` | yes | P.CREDENTIAL_READ | woreda |
| `woreda.credentials.$requestId.print.tsx` | `/woreda/credentials/$requestId/print` | yes | P.CREDENTIAL_PRINT | woreda |
| `woreda.credentials.index.tsx` | `/woreda/credentials/` | yes | P.CREDENTIAL_ISSUE, P.CREDENTIAL_VERIFY | woreda |
| `woreda.credentials.new.tsx` | `/woreda/credentials/new` | yes | P.CREDENTIAL_ISSUE | woreda |
| `woreda.credentials.tsx` | `/woreda/credentials` | yes | Module:credentials | woreda |
| `woreda.credentials.verify.tsx` | `/woreda/credentials/verify` | yes | P.CREDENTIAL_VERIFY | woreda |
| `woreda.dashboard.tsx` | `/woreda/dashboard` | yes | P.AUDIT_VIEW | woreda |
| `woreda.households.$householdId.edit.tsx` | `/woreda/households/$householdId/edit` | yes | P.HOUSEHOLD_UPDATE | woreda |
| `woreda.households.$householdId.index.tsx` | `/woreda/households/$householdId/` | yes | — | woreda |
| `woreda.households.$householdId.print.tsx` | `/woreda/households/$householdId/print` | yes | — | woreda |
| `woreda.households.index.tsx` | `/woreda/households/` | yes | P.HOUSEHOLD_CREATE, P.HOUSEHOLD_UPDATE | woreda |
| `woreda.households.new.tsx` | `/woreda/households/new` | yes | P.HOUSEHOLD_CREATE | woreda |
| `woreda.households.tsx` | `/woreda/households` | yes | — | woreda |
| `woreda.rental-accounts.$occupancyId.tsx` | `/woreda/rental-accounts/$occupancyId` | yes | — | woreda |
| `woreda.rental-houses.$houseId.edit.tsx` | `/woreda/rental-houses/$houseId/edit` | yes | — | woreda |
| `woreda.rental-houses.$houseId.index.tsx` | `/woreda/rental-houses/$houseId/` | yes | — | woreda |
| `woreda.rental-houses.$houseId.occupant-print.tsx` | `/woreda/rental-houses/$houseId/occupant-print` | yes | — | woreda |
| `woreda.rental-houses.index.tsx` | `/woreda/rental-houses/` | yes | — | woreda |
| `woreda.rental-houses.new.tsx` | `/woreda/rental-houses/new` | yes | — | woreda |
| `woreda.rental-houses.occupants.new.tsx` | `/woreda/rental-houses/occupants/new` | yes | — | woreda |
| `woreda.rental-houses.requests.$requestId.index.tsx` | `/woreda/rental-houses/requests/$requestId/` | yes | — | woreda |
| `woreda.rental-houses.requests.index.tsx` | `/woreda/rental-houses/requests/` | yes | — | woreda |
| `woreda.rental-reports.tsx` | `/woreda/rental-reports` | yes | — | woreda |
| `woreda.reports.$reportType.print.tsx` | `/woreda/reports/$reportType/print` | yes | P.REPORT_EXPORT | woreda |
| `woreda.reports.index.tsx` | `/woreda/reports/` | yes | Module:reports | woreda |
| `woreda.reports.tsx` | `/woreda/reports` | yes | — | woreda |
| `woreda.residents.$residentId.edit.tsx` | `/woreda/residents/$residentId/edit` | yes | P.RESIDENT_UPDATE | woreda |
| `woreda.residents.$residentId.index.tsx` | `/woreda/residents/$residentId/` | yes | P.RESIDENT_UPDATE | woreda |
| `woreda.residents.$residentId.print.tsx` | `/woreda/residents/$residentId/print` | yes | — | woreda |
| `woreda.residents.index.tsx` | `/woreda/residents/` | yes | P.RESIDENT_CREATE, P.RESIDENT_UPDATE | woreda |
| `woreda.residents.new.tsx` | `/woreda/residents/new` | yes | — | woreda |
| `woreda.residents.tsx` | `/woreda/residents` | yes | — | woreda |
| `woreda.revenue.$paymentId.receipt.tsx` | `/woreda/revenue/$paymentId/receipt` | yes | P.REVENUE_RECEIPT_REPRINT | woreda |
| `woreda.revenue.index.tsx` | `/woreda/revenue/` | yes | — | woreda |
| `woreda.revenue.tsx` | `/woreda/revenue` | yes | Module:revenue | woreda |
| `woreda.services.$requestId.index.tsx` | `/woreda/services/$requestId/` | yes | P.SERVICE_APPROVE, P.SERVICE_RECORD_PAYMENT | woreda |
| `woreda.services.$requestId.print.tsx` | `/woreda/services/$requestId/print` | yes | — | woreda |
| `woreda.services.index.tsx` | `/woreda/services/` | yes | — | woreda |
| `woreda.services.new.tsx` | `/woreda/services/new` | yes | — | woreda |
| `woreda.services.tsx` | `/woreda/services` | yes | Module:services | woreda |
| `woreda.settings.index.tsx` | `/woreda/settings/` | yes | — | woreda |
| `woreda.settings.users-permissions.tsx` | `/woreda/settings/users-permissions` | yes | P.TENANT_MANAGE | woreda |
| `woreda.settings.woreda-configuration.tsx` | `/woreda/settings/woreda-configuration` | yes | P.TENANT_MANAGE | woreda |
| `woreda.tsx` | `/woreda` | yes | — | woreda |
