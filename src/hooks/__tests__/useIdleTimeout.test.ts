import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({
  warning: vi.fn(() => "warn-toast-id" as string | number),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMocks }));

import {
  IDLE_CHECK_INTERVAL_MS,
  IDLE_LAST_ACTIVITY_STORAGE_KEY,
  IDLE_LOGOUT_MS,
  IDLE_WARNING_MS,
} from "@/config/idleTimeout";
import { useIdleTimeout } from "../useIdleTimeout";

const OPTIONS = {
  warningMessage: "warn",
  staySignedInLabel: "stay",
  signedOutMessage: "out",
};

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function dispatchActivity() {
  act(() => {
    window.dispatchEvent(new Event("mousemove"));
  });
}

describe("useIdleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    toastMocks.warning.mockClear();
    toastMocks.info.mockClear();
    toastMocks.dismiss.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warns at the warning threshold and signs out at the logout threshold", () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ ...OPTIONS, onTimeout }));

    advance(IDLE_WARNING_MS + IDLE_CHECK_INTERVAL_MS);
    expect(toastMocks.warning).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();

    advance(IDLE_LOGOUT_MS - IDLE_WARNING_MS + IDLE_CHECK_INTERVAL_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(toastMocks.info).toHaveBeenCalledTimes(1);
  });

  it("activity before the warning postpones both thresholds", () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ ...OPTIONS, onTimeout }));

    advance(IDLE_WARNING_MS - 60_000);
    dispatchActivity();
    // Past the ORIGINAL warning point, but under it relative to the reset.
    advance(2 * 60_000);
    expect(toastMocks.warning).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("activity after the warning dismisses it and prevents the sign-out", () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ ...OPTIONS, onTimeout }));

    advance(IDLE_WARNING_MS + IDLE_CHECK_INTERVAL_MS);
    expect(toastMocks.warning).toHaveBeenCalledTimes(1);

    dispatchActivity();
    expect(toastMocks.dismiss).toHaveBeenCalledWith("warn-toast-id");

    // Past the ORIGINAL logout point -- reset means no sign-out.
    advance(IDLE_LOGOUT_MS - IDLE_WARNING_MS + IDLE_CHECK_INTERVAL_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("fires onTimeout exactly once no matter how long the tab stays idle", () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ ...OPTIONS, onTimeout }));

    advance(2 * IDLE_LOGOUT_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("recent activity recorded by another tab (via localStorage) prevents the sign-out", () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ ...OPTIONS, onTimeout }));

    advance(IDLE_WARNING_MS + IDLE_CHECK_INTERVAL_MS);
    expect(toastMocks.warning).toHaveBeenCalledTimes(1);

    // Another tab marks activity: freshest timestamp wins at the next check,
    // withdrawing the warning and postponing the sign-out.
    act(() => {
      localStorage.setItem(IDLE_LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
    });
    advance(IDLE_LOGOUT_MS - IDLE_WARNING_MS + IDLE_CHECK_INTERVAL_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("stops checking after unmount", () => {
    const onTimeout = vi.fn();
    const { unmount } = renderHook(() => useIdleTimeout({ ...OPTIONS, onTimeout }));

    unmount();
    advance(2 * IDLE_LOGOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
