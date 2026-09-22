import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Banknote, Printer } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  TableToolbar,
  SortableTh,
  useClearTableFilters,
  useUrlSort,
} from "@/components/common/TableToolbar";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";
import { formatEthiopianDateShortOnly } from "@/utils/ethiopianCalendar";
import { PAYMENT_TYPE_LABEL, CHANNEL_LABEL } from "@/utils/paymentType";

export const Route = createFileRoute("/woreda/revenue/")({
  ssr: false,
  component: RevenuePage,
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

      // payment_decrypted isn't in the generated types yet (00000000000023_
      // pii_encryption.sql) -- same untyped-client cast pattern already used
      // elsewhere in this codebase for pre-typegen tables. Fetched
      // separately rather than swapping the query above's `.from()` in
      // place: that query embeds household, a two-level rental_request ->
      // rental_house join, and receipt via FK-derived PostgREST joins, which
      // are not guaranteed to resolve through a view the same way they do
      // through the base table. `.in("payment_id", ids)` rather than
      // replaying the same filters guarantees the two row sets match exactly.
      const paymentIds = (data ?? []).map((row) => row.payment_id as string);
      let decryptedAmountByPaymentId = new Map<string, number>();
      if (paymentIds.length > 0) {
        const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
        const { data: amounts, error: amountsError } = await db
          .from("payment_decrypted")
          .select("payment_id, amount_decrypted")
          .in("payment_id", paymentIds);
        if (amountsError) throw amountsError;
        decryptedAmountByPaymentId = new Map(
          (amounts ?? [])
            .filter((r: { amount_decrypted: number | null }) => r.amount_decrypted != null)
            .map((r: { payment_id: string; amount_decrypted: number }) => [
              r.payment_id,
              r.amount_decrypted,
            ]),
        );
      }

      // Normalize receipt (Supabase returns array for related; take first).
      const mapped = (data ?? []).map((row) => {
        const rec = Array.isArray(row.receipt) ? row.receipt[0] : row.receipt;
        const r = row as unknown as {
          payment_id: string;
          amount: number;
          household?: { kebele_id: string | null } | null;
          rental_request?: { rental_house?: { kebele_id: string | null } | null } | null;
        };
        const kebeleId =
          r.household?.kebele_id ?? r.rental_request?.rental_house?.kebele_id ?? null;
        return {
          ...row,
          amount: decryptedAmountByPaymentId.get(r.payment_id) ?? r.amount,
          receipt: rec ?? null,
          kebele_id: kebeleId,
        } as unknown as PaymentRow;
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
      if (!row.receipt) throw new Error("ለዚህ ክፍያ ደረሰኝ የለም / No receipt for this payment");
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
      // Opens the real two-page A4 receipt (customer copy + office stub);
      // that route owns the actual browser print trigger via its own Print
      // button, so this only needs to get the user there.
      window.open(`/woreda/revenue/${row.payment_id}/receipt`, "_blank");
    },
    onSuccess: () => {
      toast.success(
        "ደረሰኝ ተከፍቷል — በዚያ ገጽ ላይ ያለውን የአትም አዝራር ይጠቀሙ / Receipt opened — use the Print button on that page",
      );
      qc.invalidateQueries({ queryKey: ["revenue-payments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!hasPermission(P.REVENUE_VIEW)) return <Navigate to="/woreda/dashboard" />;

  return (
    <div className="space-y-4">
      <PageHeader icon={Banknote} titleAm="ገቢ" titleEn="Revenue" />
      <p className="font-am-body text-xs text-slate-500">
        የቤት ኪራይ ክፍያ አሁን የሚሰበሰበው ከየኪራይ ሂሳብ ገጽ ነው / Rental rent is now collected from each rent
        account's ledger page, not here — this list keeps showing historical rental payments for
        reference. Find the account from the rental house's detail page and use "ክፍያ ሰብስብ / Collect
        Payment" there.
      </p>

      <TableToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="ደረሰኝ ቁጥር / Receipt or reference no…"
        clearActive={filtersActive}
        onClear={() => {
          setQ("");
          clearFilters();
          setPage(0);
        }}
        onExportCsv={handleExportCsv}
        onExportPdf={handleExportPdf}
        exportBusy={exporting}
        filters={
          <>
            <div>
              <Label>የክፍያ ዓይነት / Payment type</Label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as PaymentType | "")}
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">ሁሉም ዓይነቶች / All types</option>
                <option value="rental_rent">የቤት ኪራይ / Rental Rent</option>
                <option value="credential_fee">የመታወቂያ ክፍያ / Credential Fee</option>
                <option value="service_fee">የአገልግሎት ክፍያ / Service Fee</option>
                <option value="house_rent">የቤት ኪራይ (የቀድሞ) / House Rent (legacy)</option>
                <option value="penalty">ቅጣት / Penalty</option>
              </select>
            </div>
            <div>
              <Label>ከ / Start</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label>እስከ / End</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <KebeleFilter
              value={kebeleFilter}
              onChange={(v) => {
                setKebeleFilter(v);
                setPage(0);
              }}
              hint="ከቤተሰብ ወይም ከኪራይ ክፍል ቀበሌ ጋር ይዛመዳል / Matches the household or rental unit kebele"
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-slate-500">ጠቅላላ (የተጣራ) / Total (filtered)</div>
          <div className="mt-1 text-2xl font-semibold">
            {reconciliation.grand.toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-500">ETB</span>
          </div>
        </Card>
        <Card className="p-4 md:col-span-2">
          <div className="text-xs uppercase text-slate-500">
            ማስተካከያ በዓይነት / ቻናል / Reconciliation by type / channel
          </div>
          <div className="mt-2 space-y-1 text-sm">
            {Object.entries(reconciliation.totals).length === 0 && (
              <div className="text-slate-500">No payments in range.</div>
            )}
            {Object.entries(reconciliation.totals).map(([k, v]) => {
              const [type, channel] = k.split("/");
              return (
                <div key={k} className="flex justify-between">
                  <span>
                    {PAYMENT_TYPE_LABEL[type] ?? type} · {CHANNEL_LABEL[channel] ?? channel}
                  </span>
                  <span className="font-medium">{v.toLocaleString()} ETB</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          ክፍያዎች / Payments
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <SortableTh field="payment_date" sort={sort}>
                  ቀን / Date
                </SortableTh>
                <SortableTh field="payment_type" sort={sort}>
                  ዓይነት / Type
                </SortableTh>
                <SortableTh field="amount" sort={sort}>
                  መጠን / Amount
                </SortableTh>
                <SortableTh field="channel" sort={sort}>
                  ቻናል / Channel
                </SortableTh>
                <th className="px-4 py-2">ማጣቀሻ / Reference</th>
                <th className="px-4 py-2">ደረሰኝ / Receipt</th>
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
                    <td className="px-4 py-2">{formatEthiopianDateShortOnly(p.payment_date)}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">
                        {PAYMENT_TYPE_LABEL[p.payment_type] ?? p.payment_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-medium">{Number(p.amount).toLocaleString()}</td>
                    <td className="px-4 py-2">{CHANNEL_LABEL[p.channel] ?? p.channel}</td>
                    <td className="px-4 py-2">{p.reference_no ?? "—"}</td>
                    <td className="px-4 py-2">
                      {p.receipt ? (
                        <span>
                          {p.receipt.receipt_number}
                          {p.receipt.printed_at && (
                            <span className="ml-1 text-xs text-slate-500">(ታትሟል / printed)</span>
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
                          {p.receipt.printed_at ? "እንደገና አትም / Reprint" : "አትም / Print"}
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
    </div>
  );
}
