import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Wallet, Receipt, Banknote, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { DetailHeader } from "@/components/common/DetailHeader";
import { TableSkeletonRows, TableEmptyRow, TableErrorRow } from "@/components/common/TableStates";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResidentSearchPicker } from "@/components/forms/ResidentSearchPicker";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import {
  ETHIOPIAN_MONTHS_AM,
  ETHIOPIAN_MONTHS_EN,
  ethiopianToGregorian,
  formatEthiopianDateShort,
  gregorianToEthiopian,
  parseDateOnly,
} from "@/utils/ethiopianCalendar";

const CHANNEL_LABEL: Record<string, string> = {
  cash: "ጥሬ ገንዘብ / Cash",
  bank: "ባንክ / Bank",
  mobile: "ሞባይል / Mobile",
};

type SettleResult =
  | { status: "settled"; payment_id: string }
  | { status: "idempotent_replay"; payment_id: string }
  | { status: "mismatch"; exception_id: string; expected_amount: number; received_amount: number };

function toEth(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseDateOnly(iso);
  if (!d) return "—";
  return formatEthiopianDateShort(d);
}

export const Route = createFileRoute("/woreda/rental-accounts/$occupancyId")({
  ssr: false,
  component: RentAccountLedgerPage,
});

const STATUS_LABEL: Record<string, { am: string; en: string; tone: string }> = {
  scheduled: { am: "የታቀደ", en: "Scheduled", tone: "bg-slate-100 text-slate-700" },
  due: { am: "የሚከፈል", en: "Due", tone: "bg-amber-100 text-amber-800" },
  overdue: { am: "ያለፈ ጊዜ", en: "Overdue", tone: "bg-red-100 text-red-800" },
  paid: { am: "ተከፍሏል", en: "Paid", tone: "bg-green-100 text-green-800" },
  waived: { am: "ተሰርዟል", en: "Waived", tone: "bg-blue-100 text-blue-800" },
  cancelled: { am: "ተሰርዟል", en: "Cancelled", tone: "bg-slate-100 text-slate-500" },
};

const ACCOUNT_STATUS_LABEL: Record<string, { am: string; en: string }> = {
  active: { am: "ንቁ", en: "Active" },
  suspended: { am: "ታግዷል", en: "Suspended" },
  terminated: { am: "ተቋርጧል", en: "Terminated" },
  closed: { am: "ተዘግቷል", en: "Closed" },
};

function periodLabel(periodKey: string): string {
  const [yearStr, monthStr] = periodKey.split("-");
  const monthIdx = Number(monthStr) - 1;
  if (Number.isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return periodKey;
  return `${ETHIOPIAN_MONTHS_AM[monthIdx]} / ${ETHIOPIAN_MONTHS_EN[monthIdx]} ${yearStr}`;
}

/** Current-or-next billable (non-Pagume) EC period, for the billing dialog's default. */
function defaultTargetPeriod(): { year: number; month: number } {
  const eth = gregorianToEthiopian(new Date());
  if (eth.month === 13) return { year: eth.year + 1, month: 1 };
  return { year: eth.year, month: eth.month };
}

function RentAccountLedgerPage() {
  const { occupancyId } = Route.useParams();
  const qc = useQueryClient();
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [billingOpen, setBillingOpen] = useState(false);
  const initial = defaultTargetPeriod();
  const [targetYear, setTargetYear] = useState(String(initial.year));
  const [targetMonth, setTargetMonth] = useState(String(initial.month));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleChannel, setSettleChannel] = useState<"cash" | "bank" | "mobile">("cash");
  const [settleReference, setSettleReference] = useState("");
  const [payerResidentId, setPayerResidentId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const [reverseTarget, setReverseTarget] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const { data: account, isLoading: accountLoading } = useQuery({
    queryKey: ["rent-account", occupancyId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rent_account")
        .select(
          `rent_account_id, account_number, status, billing_start_period_key, billing_end_period_key,
           resident_id, resident:resident_id (full_name_am, full_name),
           house:rental_house_id (house_number)`,
        )
        .eq("occupancy_id", occupancyId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const {
    data: charges,
    isLoading: chargesLoading,
    error: chargesError,
  } = useQuery({
    queryKey: ["rent-charges", account?.rent_account_id],
    enabled: !!account?.rent_account_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rent_charge")
        .select(
          "rent_charge_id, ethiopian_period_key, due_date, total_amount, status, settled_by_payment_id",
        )
        .eq("rent_account_id", account!.rent_account_id)
        .order("ethiopian_period_key", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: policy } = useQuery({
    queryKey: ["rental-policy-due-day", woredaId],
    enabled: !!woredaId && billingOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_policy")
        .select("due_day")
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const generateBilling = useMutation({
    mutationFn: async () => {
      const year = Number(targetYear);
      const month = Number(targetMonth);
      if (!year || month < 1 || month > 12) {
        throw new Error("ልክ ያልሆነ ወር / Invalid period — Pagume (13) is not billable");
      }
      const targetPeriod = `${year}-${String(month).padStart(2, "0")}`;
      const dueDay = policy?.due_day ?? 10;
      const dueDate = ethiopianToGregorian({ year, month, day: dueDay });
      const dueDateIso = dueDate.toISOString().slice(0, 10);
      const { data, error } = await supabase.rpc("generate_rent_charges", {
        _target_period: targetPeriod,
        _due_date: dueDateIso,
      });
      if (error) throw error;
      return data as { charges_created: number; skipped: number; accounts_examined: number };
    },
    onSuccess: (data) => {
      toast.success(
        `ክፍያ ተፈጥሯል / Billing generated — ${data.charges_created} created, ${data.skipped} skipped (${data.accounts_examined} accounts examined)`,
      );
      setBillingOpen(false);
      qc.invalidateQueries({ queryKey: ["rent-charges"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedTotal = (charges ?? [])
    .filter((c) => selected.has(c.rent_charge_id))
    .reduce((sum, c) => sum + Number(c.total_amount), 0);

  function openSettleDialog() {
    setSettleAmount(selectedTotal.toFixed(2));
    setSettleReference("");
    setPayerResidentId(account?.resident_id ?? "");
    setIdempotencyKey(crypto.randomUUID());
    setSettleOpen(true);
  }

  const settlePayment = useMutation({
    mutationFn: async () => {
      const amount = Number(settleAmount);
      if (!amount || amount <= 0) {
        throw new Error("ልክ ያልሆነ መጠን / Invalid amount");
      }
      const { data, error } = await supabase.rpc("settle_rent_payment", {
        _rent_account_id: account!.rent_account_id,
        _rent_charge_ids: Array.from(selected),
        _payment_amount: amount,
        _payment_date: new Date().toISOString().slice(0, 10),
        _channel: settleChannel,
        _reference_number: settleReference || null,
        _payer_resident_id: payerResidentId || null,
        _idempotency_key: idempotencyKey,
      } as never);
      if (error) throw error;
      return data as SettleResult;
    },
    onSuccess: (data) => {
      if (data.status === "mismatch") {
        toast.error(
          `የክፍያ መጠን አይመሳሰልም / Amount mismatch — expected ${data.expected_amount}, received ${data.received_amount}. ልዩነቱ ለሂሳብ ማስተካከያ ተመዝግቧል / Recorded as a reconciliation exception.`,
        );
        return;
      }
      if (data.status === "idempotent_replay") {
        toast.info("ይህ ክፍያ ቀደም ብሎ ተመዝግቧል / This payment was already recorded");
      } else {
        toast.success("ክፍያ ተመዝግቧል / Payment recorded — receipt generated");
      }
      setSettleOpen(false);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["rent-charges"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reversePayment = useMutation({
    mutationFn: async () => {
      if (!reverseTarget) return;
      const { error } = await supabase.rpc("reverse_rental_payment", {
        _payment_id: reverseTarget,
        _reason: reverseReason || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ክፍያ ተመላሽ ተደርጓል / Payment reversed — months reopened");
      setReverseTarget(null);
      setReverseReason("");
      qc.invalidateQueries({ queryKey: ["rent-charges"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!woredaId) return null;
  if (!accountLoading && !account) {
    return <Navigate to="/woreda/rental-houses" />;
  }

  return (
    <div className="space-y-4 p-4">
      <DetailHeader
        icon={Wallet}
        titleAm="የኪራይ ሂሳብ"
        titleEn={
          account
            ? `Rent Ledger — ${account.account_number} (${account.house?.house_number ?? "—"})`
            : "Rent Ledger"
        }
        backHref="/woreda/rental-houses"
      />

      {account && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div>
              <div className="font-am-body text-xs text-slate-500">ቀሪ ደረሰኝ / Account</div>
              <div className="font-medium">{account.account_number}</div>
            </div>
            <div>
              <div className="font-am-body text-xs text-slate-500">ተከራይ / Tenant</div>
              <div className="font-am-body">
                {account.resident?.full_name_am || account.resident?.full_name || "—"}
              </div>
            </div>
            <div>
              <div className="font-am-body text-xs text-slate-500">
                ክፍያ የሚጀምርበት ጊዜ / Billing starts
              </div>
              <div>{periodLabel(account.billing_start_period_key)}</div>
            </div>
            <div>
              <div className="font-am-body text-xs text-slate-500">ሁኔታ / Status</div>
              <Badge variant={account.status === "active" ? "default" : "outline"}>
                {ACCOUNT_STATUS_LABEL[account.status]?.am ?? account.status} /{" "}
                {ACCOUNT_STATUS_LABEL[account.status]?.en ?? account.status}
              </Badge>
            </div>
            <div className="ml-auto flex gap-2">
              {hasPermission(P.RENTAL_COLLECT) && (
                <Button
                  variant="secondary"
                  disabled={selected.size === 0}
                  onClick={openSettleDialog}
                >
                  <Banknote className="mr-1 h-4 w-4" />
                  ክፍያ ሰብስብ / Collect Payment
                  {selected.size > 0 ? ` (${selectedTotal.toLocaleString()} ETB)` : ""}
                </Button>
              )}
              {hasPermission(P.RENTAL_BILLING) && (
                <Button onClick={() => setBillingOpen(true)}>
                  <Receipt className="mr-1 h-4 w-4" />
                  ክፍያ ማመንጨት / Generate Billing
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          የወርሃዊ ኪራይ ክፍያዎች / Monthly Rent Charges
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="w-10 px-4 py-2"></th>
                <th className="px-4 py-2">ወር / Period</th>
                <th className="px-4 py-2">የመጨረሻ ቀን / Due</th>
                <th className="px-4 py-2">መጠን / Amount (ETB)</th>
                <th className="px-4 py-2">ሁኔታ / Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {chargesLoading && <TableSkeletonRows cols={6} />}
              {chargesError && (
                <TableErrorRow
                  cols={6}
                  error={chargesError}
                  onRetry={() => qc.invalidateQueries({ queryKey: ["rent-charges"] })}
                />
              )}
              {!chargesLoading && !chargesError && (charges ?? []).length === 0 && (
                <TableEmptyRow
                  cols={6}
                  labelAm="ገና ክፍያ አልተፈጠረም"
                  labelEn="No charges generated yet"
                />
              )}
              {(charges ?? []).map((c) => {
                const st = STATUS_LABEL[c.status] ?? STATUS_LABEL.due;
                const selectable = c.status === "due" || c.status === "overdue";
                return (
                  <tr key={c.rent_charge_id} className="border-t">
                    <td className="px-4 py-2">
                      {selectable && hasPermission(P.RENTAL_COLLECT) && (
                        <Checkbox
                          checked={selected.has(c.rent_charge_id)}
                          onCheckedChange={(checked) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(c.rent_charge_id);
                              else next.delete(c.rent_charge_id);
                              return next;
                            });
                          }}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2">{periodLabel(c.ethiopian_period_key)}</td>
                    <td className="px-4 py-2">{toEth(c.due_date)}</td>
                    <td className="px-4 py-2">{Number(c.total_amount).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${st.tone}`}>
                        {st.am} / {st.en}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {c.status === "paid" &&
                        c.settled_by_payment_id &&
                        hasPermission(P.RENTAL_REVERSE) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setReverseTarget(c.settled_by_payment_id!)}
                          >
                            <Undo2 className="mr-1 h-3.5 w-3.5" />
                            ተመላሽ / Reverse
                          </Button>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={billingOpen} onOpenChange={setBillingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ክፍያ ማመንጨት / Generate Billing for Period</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>ዓመት (EC) / Year</Label>
              <Input
                type="number"
                value={targetYear}
                onChange={(e) => setTargetYear(e.target.value)}
              />
            </div>
            <div>
              <Label>ወር / Month (1–12, Meskerem–Nehase)</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            ጳጉሜ (13) አይፈቀድም — ኪራይ ከመስከረም እስከ ነሐሴ ብቻ ይከፈላል / Pagume is not billable — rent runs
            Meskerem through Nehase only.
          </p>
          <DialogFooter>
            <Button onClick={() => generateBilling.mutate()} disabled={generateBilling.isPending}>
              ማመንጨት / Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ክፍያ ሰብስብ / Collect Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              የተመረጡ ወራት / Selected months: {selected.size} — ጠቅላላ / Total:{" "}
              {selectedTotal.toLocaleString()} ETB
            </p>
            <div>
              <Label>የተቀበለው መጠን / Amount received (ETB)</Label>
              <Input
                type="number"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                ከጠቅላላ መጠን ጋር ትክክል መሆን አለበት፣ ካልሆነ ወራቱ ሳይከፈሉ ለሂሳብ ማስተካከያ ይመዘገባል / Must exactly match
                the total — a mismatch is still recorded, but flagged for reconciliation instead of
                settling the months.
              </p>
            </div>
            <div>
              <Label>የክፍያ መንገድ / Channel</Label>
              <div className="flex gap-2">
                {(["cash", "bank", "mobile"] as const).map((ch) => (
                  <Button
                    key={ch}
                    type="button"
                    size="sm"
                    variant={settleChannel === ch ? "default" : "outline"}
                    onClick={() => setSettleChannel(ch)}
                  >
                    {CHANNEL_LABEL[ch]}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label>ማጣቀሻ ቁጥር / Reference number (optional)</Label>
              <Input value={settleReference} onChange={(e) => setSettleReference(e.target.value)} />
            </div>
            <div>
              <Label>የከፈለው ነዋሪ / Payer (optional, defaults to the tenant)</Label>
              <ResidentSearchPicker
                value={payerResidentId}
                onChange={(id) => setPayerResidentId(id)}
                woredaId={woredaId}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleOpen(false)}>
              ይቅር / Cancel
            </Button>
            <Button onClick={() => settlePayment.mutate()} disabled={settlePayment.isPending}>
              ክፍያ መዝግብ / Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!reverseTarget}
        onOpenChange={(open) => {
          if (!open) {
            setReverseTarget(null);
            setReverseReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ክፍያ ተመላሽ / Reverse Payment</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            ይህ ክፍያ የከፈላቸው ወራት ወደ ያልተከፈለ ይመለሳሉ / The months this payment settled will reopen as
            unpaid.
          </p>
          <div>
            <Label>ምክንያት / Reason</Label>
            <Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseTarget(null)}>
              ይቅር / Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => reversePayment.mutate()}
              disabled={reversePayment.isPending}
            >
              ተመላሽ አድርግ / Confirm Reverse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
