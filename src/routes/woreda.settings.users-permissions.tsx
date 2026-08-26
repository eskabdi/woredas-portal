import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { PermissionGate } from "@/components/common/PermissionGate";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { P } from "@/config/permissions";
import { RolesPermissionsTab } from "@/components/settings/RolesPermissionsTab";
import { UsersRolesTab } from "@/components/settings/UsersRolesTab";
import { UserCog } from "lucide-react";

export const Route = createFileRoute("/woreda/settings/users-permissions")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.TENANT_MANAGE}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to manage users and permissions.</p>
        </div>
      }
    >
      <UsersPermissionsPage />
    </PermissionGate>
  ),
});

function UsersPermissionsPage() {
  return (
    <div className="pb-12">
      <PageHeader
        icon={UserCog}
        titleAm="ተጠቃሚዎች እና ፈቃዶች"
        titleEn="Users and Permissions"
        description="የተጠቃሚ ሚናዎች እና የስራ ድርሻ አስተዳደር / Role permissions & staff account administration"
      />

      <Tabs defaultValue="roles" className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-slate-200 bg-transparent p-0">
          <SettingsTab value="roles" labelAm="የተጠቃሚ ሚናዎች" labelEn="Roles & Permissions" />
          <SettingsTab value="users" labelAm="ተጠቃሚዎች እና የስራ ድርሻ" labelEn="Users & Roles" />
        </TabsList>

        <TabsContent value="roles" className="mt-6">
          <RolesPermissionsTab />
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <UsersRolesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SettingsTab({
  value,
  labelAm,
  labelEn,
}: {
  value: string;
  labelAm: string;
  labelEn: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="relative rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-slate-600 shadow-none data-[state=active]:border-blue-700 data-[state=active]:bg-transparent data-[state=active]:text-blue-800 data-[state=active]:shadow-none"
    >
      <div className="flex flex-col items-start leading-tight">
        <span className="font-noto-ethiopic text-sm font-medium">{labelAm}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{labelEn}</span>
      </div>
    </TabsTrigger>
  );
}
