import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReportSection } from "@/utils/reportExport";
import { serviceStatusLabel } from "@/lib/serviceConstants";

export interface ReportData {
  residents: { kebele: string; sex: string; status: string; created_at: string }[];
  households: { kebele: string; occupancy: string }[];
  credentials: { status: string; type: string; created_at: string }[];
  events: { type: string; status: string; event_date: string }[];
  payments: {
    type: string;
    amount: number;
    channel: string;
    date: string;
    rentalHouseId: string | null;
  }[];
  rental: { status: string; rentalHouseId: string }[];
  services: { status: string; type: string; submitted_at: string }[];
}

/** Keeps only rows whose derived kebele matches the selected filter. */
function byKebele<T extends { _kebeleId: string | null }>(rows: T[], kebeleId: string): T[] {
  return kebeleId ? rows.filter((r) => r._kebeleId === kebeleId) : rows;
}

/**
 * Shared aggregation behind the Reports dashboard (woreda.reports.tsx) and
 * the per-tab printable reports (woreda.reports.$reportType.print.tsx) --
 * one source of truth so the printed document can never drift from what the
 * screen showed for the same date range and kebele filter.
 */
export function useReportsAggregate({
  woredaId,
  start,
  end,
  kebeleId,
}: {
  woredaId: string | null;
  start: string;
  end: string;
  kebeleId: string;
}) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["woreda-reports", woredaId, start, end, kebeleId],
    enabled: !!woredaId,
    queryFn: async (): Promise<ReportData> => {
      const from = `${start}T00:00:00.000Z`;
      const to = `${end}T23:59:59.999Z`;

      const [res, hh, cred, ev, pay, rent, svc] = await Promise.all([
        supabase
          .from("resident")
          .select(
            "sex, residency_status, active_flag, created_at, household:current_household_id ( kebele_id, kebele:kebele_id ( kebele_name_am, kebele_number ) )",
          )
          .eq("woreda_id", woredaId!)
          .limit(5000),
        supabase
          .from("household")
          .select("occupancy_status, kebele_id, kebele:kebele_id ( kebele_name_am, kebele_number )")
          .eq("woreda_id", woredaId!)
          .limit(5000),
        supabase
          .from("residence_credential")
          .select("status, credential_type, created_at, issuing_kebele_id")
          .eq("woreda_id", woredaId!)
          .gte("created_at", from)
          .lte("created_at", to)
          .limit(5000),
        supabase
          .from("vital_event")
          .select("event_type, status, event_date, household:household_id ( kebele_id )")
          .eq("woreda_id", woredaId!)
          .gte("event_date", start)
          .lte("event_date", end)
          .limit(5000),
        supabase
          .from("payment")
          .select(
            "payment_type, amount, channel, payment_date, status, household:household_id ( kebele_id ), rental_request:rental_request_id ( rental_house:rental_house_id ( kebele_id, rental_house_id ) )",
          )
          .eq("woreda_id", woredaId!)
          .gte("payment_date", start)
          .lte("payment_date", end)
          .limit(5000),
        supabase
          .from("kebele_rental_house")
          .select("rental_house_id, occupancy_status, kebele_id")
          .eq("woreda_id", woredaId!)
          .limit(5000),
        supabase
          .from("service_request")
          .select(
            "status, kebele_id, submitted_at, service_type:service_type_id ( name_am, name_en )",
          )
          .eq("woreda_id", woredaId!)
          .eq("category", "letter")
          .gte("submitted_at", from)
          .lte("submitted_at", to)
          .limit(5000),
      ]);

      const firstError =
        res.error || hh.error || cred.error || ev.error || pay.error || rent.error || svc.error;
      if (firstError) throw firstError;

      const kebeleLabel = (
        k: { kebele_name_am?: string | null; kebele_number?: number | null } | null,
      ) =>
        k
          ? `${k.kebele_name_am ?? "—"}${k.kebele_number != null ? ` (#${k.kebele_number})` : ""}`
          : "ያልተመደበ / Unassigned";

      return {
        residents: byKebele(
          (res.data ?? []).map((r) => {
            const row = r as unknown as {
              sex: string;
              residency_status: string;
              active_flag: boolean;
              created_at: string;
              household: {
                kebele_id: string | null;
                kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
              } | null;
            };
            return {
              _kebeleId: row.household?.kebele_id ?? null,
              kebele: kebeleLabel(row.household?.kebele ?? null),
              sex: row.sex ?? "—",
              status: row.active_flag ? row.residency_status : "inactive",
              created_at: row.created_at,
            };
          }),
          kebeleId,
        ),
        households: byKebele(
          (hh.data ?? []).map((h) => {
            const row = h as unknown as {
              occupancy_status: string;
              kebele_id: string | null;
              kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
            };
            return {
              _kebeleId: row.kebele_id ?? null,
              kebele: kebeleLabel(row.kebele),
              occupancy: row.occupancy_status,
            };
          }),
          kebeleId,
        ),
        credentials: byKebele(
          (cred.data ?? []).map((c) => {
            const row = c as unknown as {
              status: string;
              credential_type: string;
              created_at: string;
              issuing_kebele_id: string | null;
            };
            return {
              _kebeleId: row.issuing_kebele_id ?? null,
              status: row.status,
              type: row.credential_type,
              created_at: row.created_at,
            };
          }),
          kebeleId,
        ),
        events: byKebele(
          (ev.data ?? []).map((e) => {
            const row = e as unknown as {
              event_type: string;
              status: string;
              event_date: string;
              household: { kebele_id: string | null } | null;
            };
            return {
              _kebeleId: row.household?.kebele_id ?? null,
              type: row.event_type,
              status: row.status,
              event_date: row.event_date,
            };
          }),
          kebeleId,
        ),
        payments: byKebele(
          (pay.data ?? [])
            .map(
              (p) =>
                p as unknown as {
                  payment_type: string;
                  amount: number;
                  channel: string;
                  payment_date: string;
                  status: string;
                  household: { kebele_id: string | null } | null;
                  rental_request: {
                    rental_house: {
                      kebele_id: string | null;
                      rental_house_id: string | null;
                    } | null;
                  } | null;
                },
            )
            .filter((p) => p.status !== "voided")
            .map((p) => ({
              _kebeleId:
                p.household?.kebele_id ?? p.rental_request?.rental_house?.kebele_id ?? null,
              type: p.payment_type,
              amount: Number(p.amount ?? 0),
              channel: p.channel,
              date: p.payment_date,
              rentalHouseId: p.rental_request?.rental_house?.rental_house_id ?? null,
            })),
          kebeleId,
        ),
        rental: byKebele(
          (rent.data ?? []).map((r) => {
            const row = r as unknown as {
              rental_house_id: string;
              occupancy_status: string;
              kebele_id: string | null;
            };
            return {
              _kebeleId: row.kebele_id ?? null,
              status: row.occupancy_status,
              rentalHouseId: row.rental_house_id,
            };
          }),
          kebeleId,
        ),
        services: byKebele(
          (svc.data ?? []).map((s) => {
            const row = s as unknown as {
              status: string;
              kebele_id: string | null;
              submitted_at: string;
              service_type: { name_am: string | null; name_en: string | null } | null;
            };
            return {
              _kebeleId: row.kebele_id ?? null,
              status: row.status,
              type: row.service_type?.name_am
                ? `${row.service_type.name_am} / ${row.service_type.name_en ?? ""}`
                : "—",
              submitted_at: row.submitted_at,
            };
          }),
          kebeleId,
        ),
      };
    },
  });

  const agg = useMemo(() => {
    const d = data;
    const count = <T>(items: T[], key: (t: T) => string) => {
      const m = new Map<string, number>();
      items.forEach((i) => {
        const k = key(i) || "—";
        m.set(k, (m.get(k) ?? 0) + 1);
      });
      return [...m.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    };
    if (!d) {
      return {
        residentsByKebele: [],
        residentsBySex: [],
        residentsByStatus: [],
        householdsByKebele: [],
        credentialsByStatus: [],
        credentialsByType: [],
        eventsByType: [],
        paymentsByType: [] as { name: string; value: number }[],
        paymentsByChannel: [] as { name: string; value: number }[],
        rentalByStatus: [],
        rentalByPaymentStatus: [],
        serviceByStatus: [],
        serviceByType: [],
        totalRevenue: 0,
        newResidents: 0,
        totalResidents: 0,
        totalHouseholds: 0,
        totalCredentials: 0,
        totalEvents: 0,
        totalRentalHouses: 0,
        totalServiceRequests: 0,
        paymentsCount: 0,
        eventsIssued: 0,
        serviceIssued: 0,
        occupiedRentalHouses: 0,
        rentalPaid: 0,
        rentalDue: 0,
      };
    }
    const sumBy = (key: (p: ReportData["payments"][number]) => string) => {
      const m = new Map<string, number>();
      d.payments.forEach((p) => m.set(key(p), (m.get(key(p)) ?? 0) + p.amount));
      return [...m.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    };
    // A house counts as "Paid" for the period when at least one rental_rent
    // (or legacy house_rent) payment landed against it in [start, end] --
    // recurring rent collections all reuse the occupancy's original
    // rental_request_id (see woreda.revenue.index.tsx's collect mutation),
    // so that's the stable key tying a payment back to a specific house.
    const paidRentalHouseIds = new Set(
      d.payments
        .filter((p) => p.type === "rental_rent" || p.type === "house_rent")
        .map((p) => p.rentalHouseId)
        .filter((id): id is string => !!id),
    );
    const occupiedRental = d.rental.filter((r) => r.status === "occupied");
    const rentalPaid = occupiedRental.filter((r) => paidRentalHouseIds.has(r.rentalHouseId)).length;
    const rentalDue = occupiedRental.length - rentalPaid;

    return {
      residentsByKebele: count(d.residents, (r) => r.kebele),
      residentsBySex: count(d.residents, (r) => r.sex),
      residentsByStatus: count(d.residents, (r) => r.status),
      householdsByKebele: count(d.households, (h) => h.kebele),
      credentialsByStatus: count(d.credentials, (c) => c.status),
      credentialsByType: count(d.credentials, (c) => c.type),
      eventsByType: count(d.events, (e) => e.type),
      paymentsByType: sumBy((p) => p.type),
      paymentsByChannel: sumBy((p) => p.channel),
      rentalByStatus: count(d.rental, (r) => r.status),
      rentalByPaymentStatus: [
        { name: "የተከፈለ / Paid", value: rentalPaid },
        { name: "ያልተከፈለ / Due (Uncollected)", value: rentalDue },
      ],
      serviceByStatus: count(d.services, (s) => serviceStatusLabel(s.status)),
      serviceByType: count(d.services, (s) => s.type),
      totalRevenue: d.payments.reduce((s, p) => s + p.amount, 0),
      newResidents: d.residents.filter((r) => r.created_at >= `${start}T00:00:00`).length,
      totalResidents: d.residents.length,
      totalHouseholds: d.households.length,
      totalCredentials: d.credentials.length,
      totalEvents: d.events.length,
      totalRentalHouses: d.rental.length,
      totalServiceRequests: d.services.length,
      paymentsCount: d.payments.length,
      eventsIssued: d.events.filter((e) => e.status === "issued").length,
      serviceIssued: d.services.filter((s) => s.status === "issued").length,
      occupiedRentalHouses: occupiedRental.length,
      rentalPaid,
      rentalDue,
    };
  }, [data, start]);

  const tabSections = useMemo<
    Record<string, { titleAm: string; titleEn: string; sections: ReportSection[] }>
  >(
    () => ({
      population: {
        titleAm: "የሕዝብ ሪፖርት",
        titleEn: "Population report",
        sections: [
          { titleAm: "ነዋሪዎች በቀበሌ", titleEn: "Residents by kebele", rows: agg.residentsByKebele },
          { titleAm: "ነዋሪዎች በጾታ", titleEn: "Residents by sex", rows: agg.residentsBySex },
          {
            titleAm: "ነዋሪዎች በሁኔታ",
            titleEn: "Residents by residency status",
            rows: agg.residentsByStatus,
          },
          { titleAm: "ቤተሰቦች በቀበሌ", titleEn: "Households by kebele", rows: agg.householdsByKebele },
        ],
      },
      credentials: {
        titleAm: "የመታወቂያ ሪፖርት",
        titleEn: "Credentials report",
        sections: [
          {
            titleAm: "መታወቂያዎች በሁኔታ",
            titleEn: "Credentials by status",
            rows: agg.credentialsByStatus,
          },
          { titleAm: "መታወቂያዎች በዓይነት", titleEn: "Credentials by type", rows: agg.credentialsByType },
        ],
      },
      civil: {
        titleAm: "የኩነት ምዝገባ ሪፖርት",
        titleEn: "Civil registration report",
        sections: [
          { titleAm: "የኩነት ምዝገባዎች በዓይነት", titleEn: "Vital events by type", rows: agg.eventsByType },
        ],
      },
      revenue: {
        titleAm: "የገቢ ሪፖርት",
        titleEn: "Revenue report",
        sections: [
          {
            titleAm: "ገቢ በዓይነት",
            titleEn: "Revenue by payment type",
            rows: agg.paymentsByType,
            valueLabel: "ETB",
          },
          {
            titleAm: "ገቢ በመክፈያ መንገድ",
            titleEn: "Revenue by channel",
            rows: agg.paymentsByChannel,
            valueLabel: "ETB",
          },
        ],
      },
      rental: {
        titleAm: "የኪራይ ቤቶች ሪፖርት",
        titleEn: "Rental houses report",
        sections: [
          {
            titleAm: "የኪራይ ቤቶች ሁኔታ",
            titleEn: "Rental houses by occupancy",
            rows: agg.rentalByStatus,
          },
          {
            titleAm: "የተያዙ ቤቶች በክፍያ ሁኔታ",
            titleEn: "Occupied houses by payment status",
            rows: agg.rentalByPaymentStatus,
          },
        ],
      },
      services: {
        titleAm: "የአገልግሎት ጥያቄ ሪፖርት",
        titleEn: "Service requests report",
        sections: [
          {
            titleAm: "የአገልግሎት ጥያቄዎች በሁኔታ",
            titleEn: "Service requests by status",
            rows: agg.serviceByStatus,
          },
          {
            titleAm: "የአገልግሎት ጥያቄዎች በዓይነት",
            titleEn: "Service requests by type",
            rows: agg.serviceByType,
          },
        ],
      },
    }),
    [agg],
  );

  return { data, isLoading, isError, isFetching, refetch, agg, tabSections };
}
