import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryBuilderMock } from "@/test/supabaseMock";

const { fromMock, rpcMock, getSessionMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  getSessionMock: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    auth: { getSession: getSessionMock },
  },
}));

import { enqueue, getQueue, clearOfflineQueue } from "@/lib/offlineQueue";
import { runSync } from "@/lib/offlineSync";

const SESSION = { data: { session: { user: { id: "actor-1" } } } };

describe("offlineSync (Task 12-C)", () => {
  beforeEach(() => {
    localStorage.clear();
    fromMock.mockReset();
    rpcMock.mockReset();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(SESSION);
  });

  it("surfaces a server rejection (a stale precondition re-validated at sync) instead of swallowing it, and removes the item from the queue", async () => {
    enqueue(
      "w1",
      "vital_event",
      "submit_intake",
      { woreda_id: "w1", event_type: "birth" },
      "civil-birth-new",
    );

    // The server's own guard rejects the now-stale submission (e.g. the
    // resident was deactivated while the request sat in the offline queue).
    const insertBuilder = createQueryBuilderMock({
      data: null,
      error: { message: "Resident is not eligible / ነዋሪው ብቁ አይደለም", code: "P0001" },
    });
    fromMock.mockReturnValue(insertBuilder);

    const results: { ok: boolean; transient: boolean; message: string }[] = [];
    await runSync("w1", (r) => results.push(r));

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].transient).toBe(false);
    expect(results[0].message).toBe("Resident is not eligible / ነዋሪው ብቁ አይደለም");
    // A definitive server rejection is not retried forever -- it's removed.
    expect(getQueue("w1")).toHaveLength(0);
  });

  it("leaves a transient (network) failure queued for the next sync attempt, with attemptCount bumped", async () => {
    const item = enqueue("w1", "service_request", "submit_intake", {}, "service-new");

    const insertBuilder = createQueryBuilderMock({
      data: null,
      error: { message: "Failed to fetch" }, // no .code -- never reached the server
    });
    fromMock.mockReturnValue(insertBuilder);

    const results: { ok: boolean; transient: boolean }[] = [];
    await runSync("w1", (r) => results.push(r));

    expect(results[0].ok).toBe(false);
    expect(results[0].transient).toBe(true);
    const remaining = getQueue("w1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(item.id);
    expect(remaining[0].attemptCount).toBe(1);
  });

  it("dequeues and reports success once the server accepts the replayed insert", async () => {
    enqueue("w1", "credential_request", "submit_intake", {}, "credential-new");

    const insertBuilder = createQueryBuilderMock({
      data: { credential_request_id: "cr-1", request_number: "CR-0001" },
      error: null,
    });
    fromMock
      .mockReturnValueOnce(insertBuilder) // insert into credential_request
      .mockReturnValueOnce(createQueryBuilderMock({ data: null, error: null })) // status history
      .mockReturnValueOnce(createQueryBuilderMock({ data: null, error: null })); // audit_log

    const results: { ok: boolean; message: string }[] = [];
    await runSync("w1", (r) => results.push(r));

    expect(results[0].ok).toBe(true);
    expect(results[0].message).toContain("CR-0001");
    expect(getQueue("w1")).toHaveLength(0);
  });

  it.each([
    ["credential_request", "credential_request_id, request_number"],
    ["vital_event", "vital_event_id, event_number"],
    ["service_request", "service_request_id, request_number"],
  ] as const)(
    "selects the correct id/number columns for %s -- no table has both request_number and event_number",
    async (entity, expectedSelect) => {
      enqueue("w1", entity, "submit_intake", {}, "f1");
      const builder = createQueryBuilderMock({
        data: { [`${entity}_id`]: "id-1", request_number: "N-1", event_number: "N-1" },
        error: null,
      });
      fromMock.mockReturnValue(builder);

      await runSync("w1", () => {});

      expect(builder.select).toHaveBeenCalledWith(expectedSelect);
    },
  );

  it("processes queued items sequentially, in FIFO order, one at a time", async () => {
    enqueue("w1", "vital_event", "submit_intake", { n: 1 }, "civil-birth-new");
    enqueue("w1", "vital_event", "submit_intake", { n: 2 }, "civil-death-new");

    const order: number[] = [];
    fromMock.mockImplementation(() => {
      const call = fromMock.mock.calls.length;
      return createQueryBuilderMock({ data: { vital_event_id: `ve-${call}` }, error: null });
    });

    await runSync("w1", (r) => order.push((r.item.payload as { n: number }).n));

    expect(order).toEqual([1, 2]);
  });

  it("aborts before touching the queue when the session has expired while offline -- no partial sync, no dropped item", async () => {
    enqueue("w1", "vital_event", "submit_intake", {}, "civil-birth-new");
    getSessionMock.mockResolvedValue({ data: { session: null } });

    const results: unknown[] = [];
    await runSync("w1", (r) => results.push(r));

    expect(results).toHaveLength(0);
    expect(fromMock).not.toHaveBeenCalled();
    expect(getQueue("w1")).toHaveLength(1);
  });

  const CR = "0d6f3c1a-2b4e-4c5d-8e9f-1a2b3c4d5e6f";
  const enqueuePayment = () =>
    enqueue(
      "w1",
      "credential_request",
      "record_payment_draft",
      {
        credential_request_id: CR,
        channel: "cash",
        reference_no: null,
        waived: false,
        waiver_reason: null,
      },
      "credential-payment",
    );
  const fetchReq = () =>
    createQueryBuilderMock({
      data: {
        status: "approved",
        request_type: "new_issue",
        request_number: "CR-0001",
        resident_id: "res-1",
        household_id: "hh-1",
      },
      error: null,
    });

  it("record_payment_draft: records through the single record_fee_payment RPC (P1-12), never a client-side payment/receipt insert", async () => {
    enqueuePayment();
    fromMock.mockReturnValueOnce(fetchReq());
    rpcMock.mockResolvedValue({
      data: {
        payment_id: "pay-1",
        receipt_id: "rec-1",
        receipt_number: "W1-RCT-26-000001",
        amount: 50,
        waived: false,
        status: "paid",
        already_recorded: false,
      },
      error: null,
    });

    const results: { ok: boolean; message: string }[] = [];
    await runSync("w1", (r) => results.push(r));

    expect(results[0].ok).toBe(true);
    expect(results[0].message).toContain("CR-0001");
    expect(getQueue("w1")).toHaveLength(0);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("record_fee_payment", {
      _entity: "credential_request",
      _entity_id: CR,
      _channel: "cash",
      _reference_no: null,
      _waived: false,
      _waiver_reason: null,
    });
    // Only the read of the request -- no payment, receipt, status, history or audit write from the client.
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("record_payment_draft: a replay whose first attempt already committed is a success, not a second payment", async () => {
    enqueuePayment();
    fromMock.mockReturnValueOnce(fetchReq());
    rpcMock.mockResolvedValue({
      data: { payment_id: "pay-1", status: "paid", already_recorded: true },
      error: null,
    });

    const results: { ok: boolean }[] = [];
    await runSync("w1", (r) => results.push(r));

    expect(results[0].ok).toBe(true);
    expect(getQueue("w1")).toHaveLength(0);
  });

  it("record_payment_draft: surfaces a server rejection and drops the item without any other write", async () => {
    enqueuePayment();
    fromMock.mockReturnValueOnce(fetchReq());
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "ጥያቄው ለክፍያ ዝግጁ አይደለም (ሁኔታ: rejected) / The request is not ready for payment",
        code: "23514",
      },
    });

    const results: { ok: boolean; transient: boolean; message: string }[] = [];
    await runSync("w1", (r) => results.push(r));

    expect(results[0].ok).toBe(false);
    expect(results[0].transient).toBe(false);
    expect(results[0].message).toContain("not ready for payment");
    expect(getQueue("w1")).toHaveLength(0);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("ties into sign-out clearing -- clearOfflineQueue() empties the queue F-08 already sweeps", () => {
    enqueue("w1", "vital_event", "submit_intake", {}, "civil-birth-new");
    expect(getQueue("w1")).toHaveLength(1);

    clearOfflineQueue();

    expect(getQueue("w1")).toHaveLength(0);
  });
});
