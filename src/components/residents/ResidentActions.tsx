import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, MoreVertical } from "lucide-react";

import { PermissionGate } from "@/components/common/PermissionGate";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";

export interface ActionResident {
  resident_id: string;
  full_name: string | null;
  full_name_am: string | null;
  residency_status: string;
  active_flag: boolean;
  current_household_id: string | null;
}

type Mode = null | "addHousehold" | "suspend" | "reactivate" | "deactivate" | "activate";

interface Props {
  resident: ActionResident;
  woredaId: string;
  actorUserId: string | null;
  onChanged: () => void;
  variant?: "row" | "header";
  showView?: boolean;
  externalMode?: Mode;
  onExternalModeChange?: (m: Mode) => void;
}

export function ResidentActions({
  resident,
  woredaId,
  actorUserId,
  onChanged,
  variant = "row",
  showView = true,
  externalMode,
  onExternalModeChange,
}: Props) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission(P.RESIDENT_READ);
  const canUpdate = hasPermission(P.RESIDENT_UPDATE);
  const [internalMode, setInternalMode] = useState<Mode>(null);
  const mode = externalMode !== undefined ? externalMode : internalMode;
  const setMode = (m: Mode) => {
    if (onExternalModeChange) onExternalModeChange(m);
    else setInternalMode(m);
  };
  const [reason, setReason] = useState("");
  const close = () => {
    setMode(null);
    setReason("");
  };

  const writeAudit = async (
    action_type: string,
    old_value_json: Record<string, unknown> | null,
    new_value_json: Record<string, unknown> | null,
  ) => {
    await supabase.from("audit_log").insert({
      woreda_id: woredaId,
      actor_user_id: actorUserId,
      entity_name: "resident",
      entity_id: resident.resident_id,
      action_type,
      old_value_json: old_value_json as never,
      new_value_json: new_value_json as never,
      action_at: new Date().toISOString(),
    });
  };

  const suspendMutation = useMutation({
    mutationFn: async (reasonText: string) => {
      const { error } = await supabase
        .from("resident")
        .update({ residency_status: "suspended" })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await writeAudit(
        "RESIDENT_SUSPENDED",
        { residency_status: resident.residency_status },
        { residency_status: "suspended", reason: reasonText },
      );
    },
    onSuccess: () => {
      toast.success("ነዋሪው ታግዷል / Resident suspended");
      onChanged();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("resident")
        .update({ residency_status: "active" })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await writeAudit(
        "RESIDENT_REACTIVATED",
        { residency_status: resident.residency_status },
        { residency_status: "active" },
      );
    },
    onSuccess: () => {
      toast.success("ነዋሪው ዳግም ነቅቷል / Resident reactivated");
      onChanged();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("resident")
        .update({ active_flag: false })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await writeAudit("RESIDENT_DEACTIVATED", { active_flag: true }, { active_flag: false });
    },
    onSuccess: () => {
      toast.success("ነዋሪው ወደ ኢ-ንቁ ሁኔታ ተቀይሯል / Resident set to inactive");
      onChanged();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("resident")
        .update({ active_flag: true })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await writeAudit("RESIDENT_ACTIVATED", { active_flag: false }, { active_flag: true });
    },
    onSuccess: () => {
      toast.success("ነዋሪው ወደ ንቁ ሁኔታ ተቀይሯል / Resident restored to active");
      onChanged();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const showSuspend = canUpdate && resident.residency_status === "active";
  const showReactivate = canUpdate && resident.residency_status === "suspended";
  const showDeactivate = canUpdate && resident.active_flag === true;
  const showActivate = canUpdate && resident.active_flag === false;

  const TriggerIcon = variant === "header" ? MoreVertical : MoreHorizontal;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={variant === "header" ? "h-9 w-9 text-white hover:bg-white/15" : "h-8 w-8"}
            onClick={(e) => e.stopPropagation()}
            aria-label="Resident actions"
          >
            <TriggerIcon className={variant === "header" ? "h-5 w-5" : "h-4 w-4"} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {showView && canRead && (
            <DropdownMenuItem
              onClick={() =>
                navigate({
                  to: "/woreda/residents/$residentId",
                  params: { residentId: resident.resident_id },
                })
              }
            >
              <span className="font-noto-ethiopic">ዝርዝር ይመልከቱ</span>
              <span className="ml-2 text-xs text-slate-500">/ View</span>
            </DropdownMenuItem>
          )}
          {canUpdate && (
            <DropdownMenuItem
              onClick={() =>
                navigate({
                  to: "/woreda/residents/$residentId/edit",
                  params: { residentId: resident.resident_id },
                })
              }
            >
              <span className="font-noto-ethiopic">አስተካክል</span>
              <span className="ml-2 text-xs text-slate-500">/ Edit</span>
            </DropdownMenuItem>
          )}
          {canUpdate && (
            <DropdownMenuItem onClick={() => setMode("addHousehold")}>
              <span className="font-noto-ethiopic">ወደ ቤተሰብ ጨምር</span>
              <span className="ml-2 text-xs text-slate-500">/ Add to Household</span>
            </DropdownMenuItem>
          )}
          {(showSuspend || showReactivate || showDeactivate || showActivate) && (
            <DropdownMenuSeparator />
          )}
          {showSuspend && (
            <DropdownMenuItem
              className="text-amber-700 focus:text-amber-800"
              onClick={() => setMode("suspend")}
            >
              <span className="font-noto-ethiopic">አግድ</span>
              <span className="ml-2 text-xs text-slate-500">/ Suspend</span>
            </DropdownMenuItem>
          )}
          {showReactivate && (
            <DropdownMenuItem
              className="text-emerald-700 focus:text-emerald-800"
              onClick={() => setMode("reactivate")}
            >
              <span className="font-noto-ethiopic">ፍቀድ</span>
              <span className="ml-2 text-xs text-slate-500">/ Reactivate</span>
            </DropdownMenuItem>
          )}
          {showDeactivate && (
            <DropdownMenuItem className="text-slate-700" onClick={() => setMode("deactivate")}>
              <span className="font-noto-ethiopic">ቀይር (ኢ-ንቁ)</span>
              <span className="ml-2 text-xs text-slate-500">/ Set Inactive</span>
            </DropdownMenuItem>
          )}
          {showActivate && (
            <DropdownMenuItem
              className="text-emerald-700 focus:text-emerald-800"
              onClick={() => setMode("activate")}
            >
              <span className="font-noto-ethiopic">አንቃ</span>
              <span className="ml-2 text-xs text-slate-500">/ Reactivate</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <PermissionGate permission={P.RESIDENT_UPDATE}>
        <AddToHouseholdDialog
          open={mode === "addHousehold"}
          onClose={close}
          resident={resident}
          woredaId={woredaId}
          actorUserId={actorUserId}
          onChanged={onChanged}
        />

        <AlertDialog open={mode === "suspend"} onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-noto-ethiopic">
                ይህን ነዋሪ ለማገድ ይፈልጋሉ? / Suspend this resident?
              </AlertDialogTitle>
              <AlertDialogDescription className="font-noto-ethiopic">
                ምክንያት / Reason (required)
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ምክንያቱን ይጻፉ / Enter reason…"
              className="font-noto-ethiopic"
              rows={3}
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={reason.trim().length < 5 || suspendMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  suspendMutation.mutate(reason.trim());
                }}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <span className="font-noto-ethiopic">አግድ / Suspend</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={mode === "reactivate"} onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-noto-ethiopic">
                ነዋሪውን ዳግም ማግበር ይፈልጋሉ? / Reactivate this resident?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={reactivateMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  reactivateMutation.mutate();
                }}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <span className="font-noto-ethiopic">ፍቀድ / Reactivate</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={mode === "deactivate"} onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-noto-ethiopic">
                ይህን ነዋሪ ወደ ኢ-ንቁ ሁኔታ መቀየር ይፈልጋሉ? / Set this resident to inactive?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deactivateMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  deactivateMutation.mutate();
                }}
                className="bg-slate-700 hover:bg-slate-800"
              >
                <span className="font-noto-ethiopic">አረጋግጥ / Confirm</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={mode === "activate"} onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-noto-ethiopic">
                ነዋሪውን ወደ ንቁ ሁኔታ መቀየር ይፈልጋሉ? / Restore this resident to active?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={activateMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  activateMutation.mutate();
                }}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <span className="font-noto-ethiopic">አንቃ / Activate</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PermissionGate>
    </>
  );
}

interface HouseholdHit {
  household_id: string;
  house_number: string | null;
  kebele: { kebele_name_am: string | null; kebele_number: string | null } | null;
}

export function AddToHouseholdDialog({
  open,
  onClose,
  resident,
  woredaId,
  actorUserId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  resident: ActionResident;
  woredaId: string;
  actorUserId: string | null;
  onChanged: () => void;
}) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTerm("");
      setDebounced("");
      setSelectedId(null);
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const search = useQuery({
    queryKey: ["household-search", woredaId, debounced],
    enabled: open && !!woredaId,
    queryFn: async () => {
      let q = supabase
        .from("household")
        .select("household_id, house_number, kebele:kebele_id(kebele_name_am, kebele_number)")
        .eq("woreda_id", woredaId)
        .order("house_number", { ascending: true })
        .limit(20);
      if (debounced) {
        const escaped = debounced.replace(/[%,]/g, "");
        q = q.ilike("house_number", `%${escaped}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as HouseholdHit[];
    },
  });

  const currentHouseholdQuery = useQuery({
    queryKey: ["household-current", resident.current_household_id],
    enabled: open && !!resident.current_household_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("household")
        .select("household_id, house_number, kebele:kebele_id(kebele_name_am, kebele_number)")
        .eq("household_id", resident.current_household_id as string)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as HouseholdHit | null;
    },
  });

  const assign = useMutation({
    mutationFn: async (householdId: string) => {
      const { error } = await supabase
        .from("resident")
        .update({ current_household_id: householdId })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "resident",
        entity_id: resident.resident_id,
        action_type: "HOUSEHOLD_ASSIGNED",
        old_value_json: { current_household_id: resident.current_household_id } as never,
        new_value_json: { current_household_id: householdId } as never,
        action_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      toast.success("ነዋሪው ወደ ቤተሰብ ተጨምሯል / Resident added to household");
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const displayName = resident.full_name_am || resident.full_name || "—";
  const current = currentHouseholdQuery.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-noto-ethiopic">ወደ ቤተሰብ ጨምር / Add to Household</DialogTitle>
          <DialogDescription>
            <span className="font-noto-ethiopic">{displayName}</span>
            <br />
            <span className="text-xs text-slate-500">
              {current
                ? `አሁን: ${current.house_number ?? "—"} — ${current.kebele?.kebele_name_am ?? ""}`
                : "Currently unassigned"}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="በቤት ቁጥር ይፈልጉ / Search by house number…"
            className="font-noto-ethiopic"
            autoFocus
          />
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
            {search.isLoading && <div className="p-3 text-sm text-slate-500">Loading…</div>}
            {!search.isLoading && (search.data?.length ?? 0) === 0 && (
              <div className="p-3 text-sm text-slate-500">
                <span className="font-noto-ethiopic">ምንም አልተገኘም / No households found</span>
              </div>
            )}
            {(search.data ?? []).map((h) => {
              const isSel = h.household_id === selectedId;
              return (
                <button
                  key={h.household_id}
                  type="button"
                  onClick={() => setSelectedId(h.household_id)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                    isSel ? "bg-blue-50 text-blue-900" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="font-mono text-xs">{h.house_number ?? "—"}</span>
                  <span className="font-noto-ethiopic text-xs text-slate-600">
                    {h.kebele
                      ? `${h.kebele.kebele_number ?? ""} — ${h.kebele.kebele_name_am ?? ""}`
                      : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selectedId || assign.isPending}
            onClick={() => selectedId && assign.mutate(selectedId)}
            className="bg-blue-700 text-white hover:bg-blue-800"
          >
            <span className="font-noto-ethiopic">ጨምር / Add</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
