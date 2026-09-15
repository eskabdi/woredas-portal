import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bumpAttempt,
  clearOfflineQueue,
  dequeue,
  enqueue,
  getQueue,
  subscribe,
} from "@/lib/offlineQueue";

describe("offlineQueue (Task 12-C)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns items in FIFO insertion order -- never reordered", () => {
    enqueue("w1", "vital_event", "submit_intake", { a: 1 }, "civil-birth-new");
    enqueue("w1", "credential_request", "submit_intake", { a: 2 }, "credential-new");
    enqueue("w1", "service_request", "submit_intake", { a: 3 }, "service-new");

    const items = getQueue("w1");
    expect(items.map((i) => i.payload)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("removing the middle item keeps the remaining two in their original order", () => {
    enqueue("w1", "vital_event", "submit_intake", { a: 1 }, "f1");
    const middle = enqueue("w1", "vital_event", "submit_intake", { a: 2 }, "f2");
    enqueue("w1", "vital_event", "submit_intake", { a: 3 }, "f3");

    dequeue("w1", middle.id);

    expect(getQueue("w1").map((i) => i.payload)).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it("scopes the queue by woredaId -- one tenant's items never appear under another's key", () => {
    enqueue("w1", "vital_event", "submit_intake", { tenant: "w1" }, "f1");
    enqueue("w2", "vital_event", "submit_intake", { tenant: "w2" }, "f1");

    expect(getQueue("w1")).toHaveLength(1);
    expect(getQueue("w2")).toHaveLength(1);
    expect(getQueue("w1")[0].payload).toEqual({ tenant: "w1" });
  });

  it("bumpAttempt increments attemptCount without touching other fields or order", () => {
    const item = enqueue("w1", "vital_event", "submit_intake", { a: 1 }, "f1");
    expect(item.attemptCount).toBe(0);

    bumpAttempt("w1", item.id);
    bumpAttempt("w1", item.id);

    const [reloaded] = getQueue("w1");
    expect(reloaded.attemptCount).toBe(2);
    expect(reloaded.payload).toEqual({ a: 1 });
  });

  it("clearOfflineQueue empties every woreda's queue -- the sign-out path", () => {
    enqueue("w1", "vital_event", "submit_intake", {}, "f1");
    enqueue("w2", "service_request", "submit_intake", {}, "f1");

    clearOfflineQueue();

    expect(getQueue("w1")).toEqual([]);
    expect(getQueue("w2")).toEqual([]);
  });

  it("notifies subscribers on enqueue, dequeue and clear so useSyncExternalStore reflects it live", () => {
    const cb = vi.fn();
    const unsubscribe = subscribe("w1", cb);

    enqueue("w1", "vital_event", "submit_intake", {}, "f1");
    expect(cb).toHaveBeenCalledTimes(1);

    const [item] = getQueue("w1");
    dequeue("w1", item.id);
    expect(cb).toHaveBeenCalledTimes(2);

    clearOfflineQueue();
    expect(cb).toHaveBeenCalledTimes(3);

    unsubscribe();
    enqueue("w1", "vital_event", "submit_intake", {}, "f1");
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("survives a page reload -- backed by localStorage, not in-memory state", () => {
    enqueue("w1", "vital_event", "submit_intake", { persisted: true }, "f1");

    // Simulate "reload": read the queue back with a call that doesn't reuse
    // any module-level state, only what's actually in localStorage.
    const raw = localStorage.getItem("offline-queue:w1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });
});
