import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Banknote, Printer, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModuleGate } from "@/components/common/ModuleGate";
import { KebeleFilter } from "@/components/common/KebeleFilter";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import {
  TablePagination,
  useClientPagination,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import { TableEmptyRow, TableErrorRow, TableSkeletonRows } from "@/components/common/TableStates";
import {
  ClearFiltersButton,
  ExportButtons,
  SortableTh,
  useClearTableFilters,
  useUrlSort,
} from "@/components/common/TableToolbar";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";

export const Route = createFileRoute("/woreda/revenue")({
  ssr: false,
  component: () => (
    <ModuleGate moduleKey="revenue">
      <RevenuePage />
    </ModuleGate>
  ),
});

type PaymentType = "service_fee" | "house_rent" | "penalty" | "credential_fee" | "rental_rent";

interface PaymentRow {
  payment_id: string;
  payment_type: PaymentType;
  amount: number;
  payment_date: string;
  channel: "cash" | "bank" | "mobile";
  reference_no: string | null;
  status: string;
  credential_request_id: string | null;
  rental_request_id: string | null;
  receipt: { receipt_id: string; receipt_number: string; printed_at: string | null } | null;
  kebele_id: string | null;
}

function RevenuePage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [typeFilter, setTypeFilter] = useState<PaymentType | "">("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [kebeleFilter, setKebeleFilter] = useState("");
  const [collectOpen, setCollectOpen] = useState(false);
  const { input: q, setInput: setQ, term: qTerm } = useUrlSearchTerm();

  const qc = useQueryClient();

  const paymentsQuery = useQuery({
    queryKey: ["revenue-payments", woredaId, typeFilter, start, end, kebeleFilter],
    enabled: !!woredaId,
    queryFn: async () => {
      let q = supabase
        .from("payment")
        .select(
          `payment_id, payment_type, amount, payment_date, channel, reference_no, status, credential_request_id, rental_request_id,
           household:household_id ( kebele_id ),
           rental_request:rental_request_id ( rental_house:rental_house_id ( kebele_id ) ),
           receipt:receipt!receipt_payment_id_fkey ( receipt_id, receipt_number, printed_at )`,
        )
        .eq("woreda_id", woredaId!)
        .eq("status", "confirmed")
        .order("payment_date", { ascending: false })
        .limit(200);
      if (typeFilter) q = q.eq("payment_type", typeFilter);
      if (start) q = q.gte("payment_date", start);
      if (end) q = q.lte("payment_date", end);
      const { data, error } = await q;
      if (error) throw error;
      // Normalize receipt (Supabase returns array for related; take first).
      const mapped = (data ?? []).map((row) => {
        const rec = Array.isArray(row.receipt) ? row.receipt[0] : row.receipt;
        const r = row as unknown as {
          household?: { kebele_id: string | null } | null;
          rental_request?: { rental_house?: { kebele_id: string | null } | null } | null;
        };
        const kebeleId =
          r.household?.kebele_id ?? r.rental_request?.rental_house?.kebele_id ?? null;
        return { ...row, receipt: rec ?? null, kebele_id: kebeleId } as unknown as PaymentRow;
      });
      return kebeleFilter ? mapped.filter((p) => p.kebele_id === kebeleFilter) : mapped;
    },
  });

  const sort = useUrlSort("payment_date", "desc", "asc");

  const filteredPayments = useMemo(() => {
    const term = qTerm.toLowerCase();
    const rows = paymentsQuery.data ?? [];
    const filtered = term
      ? rows.filter((r) =>
          [r.receipt?.receipt_number, r.reference_no, r.payment_type, r.channel]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(term)),
        )
      : rows;
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sort.field) {
        case "amount":
          cmp = Number(a.amount) - Number(b.amount);
          break;
        case "payment_type":
          cmp = a.payment_type.localeCompare(b.payment_type);
          break;
        case "channel":
          cmp = a.channel.localeCompare(b.channel);
          break;
        case "payment_date":
        default:
          cmp = a.payment_date.localeCompare(b.payment_date);
          break;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [paymentsQuery.data, qTerm, sort.field, sort.dir]);

  const { page, setPage, pageSize, setPageSize, total, pageRows } = useClientPagination(
    filteredPayments,
    [qTerm, typeFilter, start, end, kebeleFilter, sort.key].join("|"),
  );

  const filtersActive = !!(qTerm || typeFilter || start || end || kebeleFilter || !sort.isDefault);
  const clearFilters = useClearTableFilters([], () => {
    setTypeFilter("");
    setStart("");
    setEnd("");
    setKebeleFilter("");
  });

  const branding = useReportBranding();
  const [exporting, setExporting] = useState(false);

  const filterLabel =
    [
      qTerm ? `Search: "${qTerm}"` : null,
      typeFilter ? `Type: ${typeFilter}` : null,
      start ? `From: ${start}` : null,
      end ? `To: ${end}` : null,
      kebeleFilter ? `Kebele: ${kebeleFilter}` : null,
      !sort.isDefault ? `Sort: ${sort.field} ${sort.dir}` : null,
    ]
      .filter(Boolean)
      .join(" • ") || "No filters applied";

  const exportColumns: TableColumn<PaymentRow>[] = [
    { header: "ቀን / Date", value: (r) => r.payment_date },
    { header: "ዓይነት / Type", value: (r) => r.payment_type },
    { header: "መጠን / Amount", value: (r) => Number(r.amount), align: "right" },
    { header: "ቻናል / Channel", value: (r) => r.channel },
    { header: "ማጣቀሻ / Reference", value: (r) => r.reference_no ?? "" },
    { header: "ደረሰኝ / Receipt No.", value: (r) => r.receipt?.receipt_number ?? "" },
    { header: "Payment ID", value: (r) => r.payment_id },
  ];

  async function handleExportCsv() {
    setExporting(true);
    try {
      exportRowsToCsv({
        fileName: `revenue-payments-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: exportColumns,
        rows: filteredPayments,
        filterLabel,
        titleEn: "Revenue Payments",
      });
      toast.success(`Exported ${filteredPayments.length} record(s) to CSV`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export CSV");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      await exportRowsToPdf({
        fileName: `revenue-payments-${new Date().toISOString().slice(0, 10)}.pdf`,
        branding: branding.data ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
        titleAm: "ገቢ",
        titleEn: "Revenue Payments",
        filterLabel,
        columns: exportColumns,
        rows: filteredPayments,
      });
      toast.success(`Exported ${filteredPayments.length} record(s) to PDF`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  }

  const reconciliation = useMemo(() => {
    const rows = paymentsQuery.data ?? [];
    const totals: Record<string, number> = {};
    let grand = 0;
    for (const r of rows) {
      const key = `${r.payment_type}/${r.channel}`;
      totals[key] = (totals[key] ?? 0) + Number(r.amount);
      grand += Number(r.amount);
    }
    return { totals, grand };
  }, [paymentsQuery.data]);

  const reprint = useMutation({
    mutationFn: async (row: PaymentRow) => {
      if (!row.receipt) throw new Error("No receipt for this payment");
      const nowIso = new Date().toISOString();
      if (!row.receipt.printed_at) {
        const { error } = await supabase
          .from("receipt")
          .update({ printed_at: nowIso })
          .eq("receipt_id", row.receipt.receipt_id);
        if (error) throw error;
      }
      await supabase.from("audit_log").insert({
        woreda_id: woredaId!,
        actor_user_id: actorUserId,
        entity_name: "receipt",
        entity_id: row.receipt.receipt_id,
        action_type: row.receipt.printed_at ? "RECEIPT_REPRINTED" : "RECEIPT_PRINTED",
        new_value_json: {
          receipt_number: row.receipt.receipt_number,
          payment_id: row.payment_id,
          amount: row.amount,
          printed_at: nowIso,
        } as never,
      });
      // Trigger browser print of a compact receipt window.
      // Values are inserted with DOM APIs (textContent) so stored data can
      // never be interpreted as HTML/script in the print window.
      const w = window.open("", "_blank", "width=420,height=600");
      if (w) {
        const doc = w.document;
        doc.title = `Receipt ${row.receipt.receipt_number}`;
        const style = doc.createElement("style");
        style.textContent =
          "body{font-family:sans-serif;padding:16px}h2{margin:0 0 8px 0}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:14px}dt{color:#64748b}";
        doc.head.appendChild(style);

        const h2 = doc.createElement("h2");
        h2.textContent = `Receipt ${row.receipt.receipt_number}`;
        doc.body.appendChild(h2);

        const dl = doc.createElement("dl");
        const rows: [string, string][] = [
          ["Payment ID", row.payment_id],
          ["Type", row.payment_type],
          ["Amount", `${Number(row.amount).toLocaleString()} ETB`],
          ["Channel", row.channel],
          ["Reference", row.reference_no ?? "—"],
          ["Date", row.payment_date],
        ];
        for (const [label, value] of rows) {
          const dt = doc.createElement("dt");
          dt.textContent = label;
          const dd = doc.createElement("dd");
          dd.textContent = String(value ?? "—");
          dl.append(dt, dd);
        }
        doc.body.appendChild(dl);
        w.print();
      }
    },
    onSuccess: () => {
      toast.success("Receipt sent to printer");
      qc.invalidateQueries({ queryKey: ["revenue-payments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!hasPermission(P.REVENUE_VIEW)) return <Navigate to="/woreda/dashboard" />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Banknote}
        titleAm="ገቢ"
        titleEn="Revenue"
        actions={
          <div className="flex items-center gap-2">
            <ExportButtons onCsv={handleExportCsv} onPdf={handleExportPdf} busy={exporting} />
            {hasPermission(P.REVENUE_COLLECT) && (
              <Button onClick={() => setCollectOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Collect Rental Rent
              </Button>
            )}
          </div>
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Payment type</Label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as PaymentType | "")}
              className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All types</option>
              <option value="rental_rent">Rental Rent</option>
              <option value="credential_fee">Credential Fee</option>
              <option value="service_fee">Service Fee</option>
              <option value="house_rent">House Rent (legacy)</option>
              <option value="penalty">Penalty</option>
            </select>
          </div>
          <div>
            <Label>Start</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>End</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <KebeleFilter
            value={kebeleFilter}
            onChange={(v) => {
              setKebeleFilter(v);
              setPage(0);
            }}
            hint="Matches the household or rental unit kebele"
          />
          <div className="min-w-[220px] flex-1">
            <Label className="font-noto-ethiopic">ፍለጋ / Search</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ደረሰኝ ቁጥር / Receipt or reference no…"
            />
          </div>
          <ClearFiltersButton
            active={filtersActive}
            onClear={() => {
              setQ("");
              clearFilters();
              setPage(0);
            }}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-slate-500">Total (filtered)</div>
          <div className="mt-1 text-2xl font-semibold">
            {reconciliation.grand.toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-500">ETB</span>
          </div>
        </Card>
        <Card className="p-4 md:col-span-2">
          <div className="text-xs uppercase text-slate-500">Reconciliation by type / channel</div>
          <div className="mt-2 space-y-1 text-sm">
            {Object.entries(reconciliation.totals).length === 0 && (
              <div className="text-slate-500">No payments in range.</div>
            )}
            {Object.entries(reconciliation.totals).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span>{k}</span>
                <span className="font-medium">{v.toLocaleString()} ETB</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          Payments
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <SortableTh field="payment_date" sort={sort}>
                  Date
                </SortableTh>
                <SortableTh field="payment_type" sort={sort}>
                  Type
                </SortableTh>
                <SortableTh field="amount" sort={sort}>
                  Amount
                </SortableTh>
                <SortableTh field="channel" sort={sort}>
                  Channel
                </SortableTh>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Receipt</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {paymentsQuery.isLoading && <TableSkeletonRows cols={7} />}
              {paymentsQuery.isError && !paymentsQuery.isLoading && (
                <TableErrorRow
                  cols={7}
                  error={paymentsQuery.error}
                  onRetry={() => paymentsQuery.refetch()}
                />
              )}
              {!paymentsQuery.isLoading && !paymentsQuery.isError && pageRows.length === 0 && (
                <TableEmptyRow
                  cols={7}
                  filtered={filtersActive}
                  onClearFilters={() => {
                    setQ("");
                    clearFilters();
                    setPage(0);
                  }}
                  labelAm="ምንም ክፍያ የለም"
                  labelEn="No payments yet"
                  filteredLabelAm="ምንም ክፍያ አልተገኘም"
                  filteredLabelEn="No payments match your search or filters"
                />
              )}
              {!paymentsQuery.isLoading &&
                !paymentsQuery.isError &&
                pageRows.map((p) => (
                  <tr key={p.payment_id} className="border-t">
                    <td className="px-4 py-2">{p.payment_date}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">{p.payment_type}</Badge>
                    </td>
                    <td className="px-4 py-2 font-medium">{Number(p.amount).toLocaleString()}</td>
                    <td className="px-4 py-2">{p.channel}</td>
                    <td className="px-4 py-2">{p.reference_no ?? "—"}</td>
                    <td className="px-4 py-2">
                      {p.receipt ? (
                        <span>
                          {p.receipt.receipt_number}
                          {p.receipt.printed_at && (
                            <span className="ml-1 text-xs text-slate-500">(printed)</span>
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {p.receipt && hasPermission(P.REVENUE_RECEIPT_REPRINT) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reprint.mutate(p)}
                          disabled={reprint.isPending}
                        >
                          <Printer className="mr-1 h-4 w-4" />
                          {p.receipt.printed_at ? "Reprint" : "Print"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Card>

      {collectOpen && (
        <CollectRentalDialog
          woredaId={woredaId!}
          actorUserId={actorUserId}
          onClose={() => setCollectOpen(false)}
          onSuccess={() => {
            setCollectOpen(false);
            qc.invalidateQueries({ queryKey: ["revenue-payments"] });
          }}
        />
      )}
    </div>
  );
}

function CollectRentalDialog({
  woredaId,
  actorUserId,
  onClose,
  onSuccess,
}: {
  woredaId: string;
  actorUserId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [requestId, setRequestId] = useState("");
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<"cash" | "bank" | "mobile">("cash");
  const [referenceNo, setReferenceNo] = useState("");

  const { data: approvedRequests } = useQuery({
    queryKey: ["approved-rental-requests", woredaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_occupancy_request")
        .select(
          `rental_request_id, request_number, rent_amount, request_type,
           resident:resident_id ( full_name_am, full_name ),
           house:rental_house_id ( house_number )`,
        )
        .eq("woreda_id", woredaId)
        .eq("status", "approved")
        .eq("request_type", "new_registration")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const collect = useMutation({
    mutationFn: async () => {
      if (!requestId) throw new Error("Select a rental request");
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      if ((channel === "bank" || channel === "mobile") && !referenceNo.trim())
        throw new Error("Reference # required for bank/mobile");

      const today = new Date().toISOString().slice(0, 10);
      const { data: pay, error: payErr } = await supabase
        .from("payment")
        .insert({
          woreda_id: woredaId,
          payment_type: "rental_rent",
          amount: amt,
          payment_date: today,
          channel,
          reference_no: referenceNo.trim() || null,
          status: "confirmed",
          posted_by_user_id: actorUserId,
          rental_request_id: requestId,
        } as never)
        .select("payment_id")
        .single();
      if (payErr) throw payErr;
      const paymentId = (pay as { payment_id: string }).payment_id;

      const { error: recErr } = await supabase.from("receipt").insert({
        woreda_id: woredaId,
        payment_id: paymentId,
        receipt_date: today,
        total_amount: amt,
        cash_bank_channel: channel,
        receipt_number: "",
      } as never);
      if (recErr) throw recErr;

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "payment",
        entity_id: paymentId,
        action_type: "RENTAL_PAYMENT_COLLECTED",
        new_value_json: {
          rental_request_id: requestId,
          amount: amt,
          channel,
        } as never,
      });
      return paymentId;
    },
    onSuccess: () => {
      toast.success("Payment recorded — receipt generated");
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Collect Rental Rent Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Rental Request</Label>
            <select
              value={requestId}
              onChange={(e) => {
                setRequestId(e.target.value);
                const sel = approvedRequests?.find((r) => r.rental_request_id === e.target.value);
                if (sel?.rent_amount != null) setAmount(String(sel.rent_amount));
              }}
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Select an approved request —</option>
              {(approvedRequests ?? []).map((r) => (
                <option key={r.rental_request_id} value={r.rental_request_id}>
                  {r.request_number} · House {r.house?.house_number ?? "?"} ·{" "}
                  {r.resident?.full_name_am || r.resident?.full_name || "—"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Amount (ETB)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>Channel</Label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as "cash" | "bank" | "mobile")}
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="mobile">Mobile</option>
            </select>
          </div>
          {channel !== "cash" && (
            <div>
              <Label>Reference No.</Label>
              <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => collect.mutate()} disabled={collect.isPending}>
            Confirm Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
