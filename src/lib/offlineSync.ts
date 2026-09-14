/**
 * Task 12-C: sequential sync engine. Processes one queued item at a time
 * (FIFO, never concurrent -- see docs/task12c-mapping-memo.md §3) by
 * replaying the exact Supabase call the online form would have made.
 * The server re-runs every trigger, RLS policy, and FSM/precondition/fee
 * guard in full -- this module's only job is to call the same insert the
 * online path calls and faithfully surface whatever the server decides,
 * never to re-implement or second-guess that decision client-side.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  getQueue,
  dequeue,
  bumpAttempt,
  type QueueItem,
  type QueueEntity,
} from "@/lib/offlineQueue";

export interface SyncResult {
  item: QueueItem;
  ok: boolean;
  /** Bilingual where the server's own guard supplies one; only falls back
   * to a generic English message for a transport-level failure the
   * server never got to see (network drop mid-request). */
  message: string;
  /** A transient failure (network) leaves the item queued for next time;
   * a server rejection (RLS, FSM, precondition, fee guard) does not --
   * retrying a definitively-refused request would just loop the same
   * rejection forever. */
  transient: boolean;
}

const ENTITY_TABLE: Record<QueueEntity, string> = {
  credential_request: "credential_request",
  vital_event: "vital_event",
  service_request: "service_request",
};

const ENTITY_ID_COLUMN: Record<QueueEntity, string> = {
  credential_request: "credential_request_id",
  vital_event: "vital_event_id",
  service_request: "service_request_id",
};

/** credential_request and service_request carry `request_number`;
 * vital_event carries `event_number` -- no table has both, so a single
 * select list naming both columns for every entity raises
 * `42703 column ... does not exist` and the insert never happens. */
const ENTITY_NUMBER_COLUMN: Record<QueueEntity, "request_number" | "event_number"> = {
  credential_request: "request_number",
  vital_event: "event_number",
  service_request: "request_number",
};

/** Only credential_request and service_request write an explicit
 * *_status_history row from the client on intake (vital_event does not --
 * the engine's own log_workflow_status_history() trigger fires on UPDATE
 * only, never on the initial INSERT, and the online civil intake forms
 * write no history row either -- confirmed by reading
 * woreda.civil.birth.new.tsx's own onSubmit, which only writes audit_log). */
const HISTORY_TABLE: Partial<Record<QueueEntity, string>> = {
  credential_request: "credential_request_status_history",
  service_request: "service_request_status_history",
};

/** Matches each entity's own online intake form's audit action_type
 * exactly -- woreda.credentials.new.tsx:555, woreda.services.new.tsx:266 --
 * so a synced submission reads identically to one submitted online. */
const AUDIT_ACTION_TYPE: Record<QueueEntity, string> = {
  credential_request: "REQUEST_SUBMITTED",
  vital_event: "VITAL_EVENT_SUBMITTED",
  service_request: "SERVICE_REQUEST_SUBMITTED",
};

/** vital_event's online intake forms each write their own specific
 * action_type (BIRTH_REGISTERED, DEATH_REGISTERED, MARRIAGE_REGISTERED,
 * DIVORCE_REGISTERED) rather than a generic one -- match that here from the
 * queued payload's own event_type so a synced civil registration doesn't
 * read differently in the audit log than one submitted online. */
const VITAL_EVENT_ACTION_TYPE: Record<string, string> = {
  birth: "BIRTH_REGISTERED",
  death: "DEATH_REGISTERED",
  marriage: "MARRIAGE_REGISTERED",
  divorce: "DIVORCE_REGISTERED",
};

function auditActionTypeFor(item: QueueItem): string {
  if (item.entity === "vital_event") {
    const eventType = (item.payload as { event_type?: string }).event_type;
    return VITAL_EVENT_ACTION_TYPE[eventType ?? ""] ?? AUDIT_ACTION_TYPE.vital_event;
  }
  return AUDIT_ACTION_TYPE[item.entity];
}

// PostgREST auth-refresh codes and the Postgres connection/resource/
// operator-intervention error classes (08*/53*/57*) mean the request never
// got a real ruling from the server's own guards -- retryable once the
// session refreshes or the transient condition clears, not a rejection to
// discard the item over. Everything else with a code (a RAISE EXCEPTION
// from an FSM/precondition trigger, a check_violation, an RLS denial) is a
// genuine, definitive server ruling.
const TRANSIENT_CODES = /^(PGRST301|PGRST302|08|53|57)/;

function isTransient(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code) return TRANSIENT_CODES.test(error.code);
  // No code at all means the request never reached the server -- a
  // fetch-level TypeError, not a PostgREST/Postgres response.
  return /fetch|network|failed to fetch|timeout/i.test(error.message ?? "");
}

async function syncSubmitIntake(item: QueueItem, actorUserId: string): Promise<SyncResult> {
  const table = ENTITY_TABLE[item.entity];
  const idColumn = ENTITY_ID_COLUMN[item.entity];
  const numberColumn = ENTITY_NUMBER_COLUMN[item.entity];

  const { data, error } = await supabase
    .from(table as never)
    .insert(item.payload as never)
    .select(`${idColumn}, ${numberColumn}`)
    .single();

  if (error) {
    return {
      item,
      ok: false,
      transient: isTransient(error),
      message: error.message,
    };
  }

  const created = data as Record<string, string>;
  const entityId = created[idColumn];
  const number = created[numberColumn] ?? "";

  // Dequeue immediately once the row genuinely exists, before the history/
  // audit follow-up writes -- an interruption after this point (tab closed,
  // connectivity drops mid-sync) must not replay the primary insert and
  // create a duplicate submission on the next sync. dequeue() is a no-op if
  // runSync's own post-processing calls it again for the same id.
  dequeue(item.woredaId, item.id);

  const historyTable = HISTORY_TABLE[item.entity];
  if (historyTable) {
    await supabase.from(historyTable as never).insert({
      [idColumn]: entityId,
      old_status: null,
      new_status: "submitted",
      changed_by_user_id: actorUserId,
      change_reason: "Submitted (synced from offline queue)",
    } as never);
  }

  await supabase.from("audit_log").insert({
    woreda_id: item.woredaId,
    actor_user_id: actorUserId,
    entity_name: item.entity,
    entity_id: entityId,
    action_type: auditActionTypeFor(item),
    new_value_json: { request_number: number, synced_from_offline: true } as never,
    action_at: new Date().toISOString(),
  });

  return {
    item,
    ok: true,
    transient: false,
    message: `ተመዝግቧል / Submitted as ${number || entityId.slice(0, 8)}`,
  };
}

/** credential_request only (see mapping memo §2/§4) -- the fee itself is
 * never carried in the payload; it is resolved fresh, server-side, at
 * sync time so a stale client-cached amount can never be trusted. This
 * mirrors PaymentCard's own handleRecord() sequence: raise the fee
 * (approved -> awaiting_payment) if needed, resolve the live fee, insert
 * the payment + receipt, then the paid transition -- all server-validated
 * at each step by the existing triggers, exactly as if the officer had
 * done this online. */
async function syncRecordPaymentDraft(item: QueueItem, actorUserId: string): Promise<SyncResult> {
  const { credential_request_id, channel, reference_no, waived, waiver_reason } = item.payload as {
    credential_request_id: string;
    channel: "cash" | "bank" | "mobile";
    reference_no: string | null;
    waived: boolean;
    waiver_reason: string | null;
  };

  const { data: req, error: reqErr } = await supabase
    .from("credential_request")
    .select("status, request_type, request_number, resident_id, household_id")
    .eq("credential_request_id", credential_request_id)
    .maybeSingle();
  if (reqErr) return { item, ok: false, transient: isTransient(reqErr), message: reqErr.message };
  if (!req) {
    return {
      item,
      ok: false,
      transient: false,
      message: "ጥያቄው አልተገኘም / The request no longer exists or is no longer visible to you",
    };
  }

  if (req.status === "approved") {
    // House rule (CLAUDE.md): error === null doesn't mean the row matched --
    // mirrors PaymentCard's own handleRecord() (woreda.credentials.$requestId.index.tsx),
    // which treats a null returned row as a failure rather than inferring
    // success from a null error alone.
    const { data: raiseRow, error: raiseErr } = await supabase
      .from("credential_request")
      .update({ status: "awaiting_payment" })
      .eq("credential_request_id", credential_request_id)
      .select("credential_request_id")
      .maybeSingle();
    if (raiseErr)
      return { item, ok: false, transient: isTransient(raiseErr), message: raiseErr.message };
    if (!raiseRow) {
      return {
        item,
        ok: false,
        transient: false,
        message:
          "ክፍያው ሊጠየቅ አልቻለም / Could not raise the fee — the request may have been moved by someone else",
      };
    }
  } else if (req.status !== "awaiting_payment") {
    return {
      item,
      ok: false,
      transient: false,
      message: `ጥያቄው ከዚህ በኋላ ለክፍያ ዝግጁ አይደለም (ሁኔታ: ${req.status}) / The request is no longer ready for payment (status: ${req.status})`,
    };
  }

  const { data: feeAmount, error: feeErr } = await supabase.rpc("resolve_credential_fee", {
    _request_type: req.request_type,
  });
  if (feeErr) return { item, ok: false, transient: isTransient(feeErr), message: feeErr.message };

  const amount = waived ? 0 : (feeAmount as number);
  const today = new Date().toISOString().slice(0, 10);

  const { data: pay, error: payErr } = await supabase
    .from("payment")
    .insert({
      woreda_id: item.woredaId,
      resident_id: req.resident_id,
      household_id: req.household_id,
      payment_type: "credential_fee",
      amount,
      payment_date: today,
      channel,
      reference_no: waived ? null : reference_no,
      status: "confirmed",
      posted_by_user_id: actorUserId,
      credential_request_id,
      waived,
      waiver_reason: waived ? waiver_reason : null,
    } as never)
    .select("payment_id")
    .single();
  if (payErr) return { item, ok: false, transient: isTransient(payErr), message: payErr.message };
  const paymentId = (pay as { payment_id: string }).payment_id;

  const { error: recErr } = await supabase.from("receipt").insert({
    woreda_id: item.woredaId,
    payment_id: paymentId,
    receipt_date: today,
    total_amount: amount,
    cash_bank_channel: channel,
    receipt_number: "",
  } as never);
  if (recErr) return { item, ok: false, transient: isTransient(recErr), message: recErr.message };

  const { data: paidRow, error: updErr } = await supabase
    .from("credential_request")
    .update({ status: "paid", payment_id: paymentId })
    .eq("credential_request_id", credential_request_id)
    .select("credential_request_id")
    .maybeSingle();
  if (updErr) return { item, ok: false, transient: isTransient(updErr), message: updErr.message };
  if (!paidRow) {
    return {
      item,
      ok: false,
      transient: false,
      message:
        "ወደ ተከፍሏል ሊዘዋወር አልቻለም / Could not move the request to paid — it may have been moved by someone else. The payment was recorded; contact an administrator to reconcile.",
    };
  }

  // Money is booked and the request is paid -- dequeue now, before the
  // history/audit follow-ups, so an interruption here never re-inserts a
  // second payment on the next sync (see syncSubmitIntake's identical note).
  dequeue(item.woredaId, item.id);

  await supabase.from("credential_request_status_history").insert({
    credential_request_id,
    old_status: "awaiting_payment",
    new_status: "paid",
    changed_by_user_id: actorUserId,
    change_reason: waived
      ? `Payment waived (synced from offline queue): ${waiver_reason}`
      : "Payment recorded (synced from offline queue)",
  } as never);

  // Matches PaymentCard's own handleRecord() audit row exactly
  // (woreda.credentials.$requestId.index.tsx) -- a payment or waiver
  // recorded via sync must appear in /woreda/audit identically to one
  // recorded online, revenue-handling actions are never audit-silent.
  await supabase.from("audit_log").insert({
    woreda_id: item.woredaId,
    actor_user_id: actorUserId,
    entity_name: "credential_request",
    entity_id: credential_request_id,
    action_type: waived ? "PAYMENT_WAIVED" : "PAYMENT_COLLECTED",
    new_value_json: {
      amount,
      channel,
      waived,
      waiver_reason: waived ? waiver_reason : undefined,
      synced_from_offline: true,
    } as never,
    action_at: new Date().toISOString(),
  });

  return {
    item,
    ok: true,
    transient: false,
    message: `ክፍያ ተመዝግቧል / Payment recorded for ${req.request_number}`,
  };
}

async function syncOne(item: QueueItem, actorUserId: string): Promise<SyncResult> {
  switch (item.action) {
    case "submit_intake":
      return syncSubmitIntake(item, actorUserId);
    case "record_payment_draft":
      return syncRecordPaymentDraft(item, actorUserId);
  }
}

/** Sequential, FIFO, one at a time. A `null` session (expired or never
 * re-authenticated after a long offline stretch) aborts before touching
 * the queue at all -- no partial sync, no item silently dropped. Returns
 * `"no-session"` in that case so the caller can tell the difference from
 * "nothing was queued" and prompt the user to sign back in, rather than
 * the sync button silently doing nothing. */
export async function runSync(
  woredaId: string,
  onItemDone: (result: SyncResult) => void,
): Promise<"synced" | "no-session"> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return "no-session";
  const actorUserId = session.user.id;

  for (const item of getQueue(woredaId)) {
    const result = await syncOne(item, actorUserId);
    if (result.ok || !result.transient) {
      dequeue(woredaId, item.id);
    } else {
      bumpAttempt(woredaId, item.id);
    }
    onItemDone(result);
  }
  return "synced";
}
