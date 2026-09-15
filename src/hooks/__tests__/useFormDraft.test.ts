import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useForm } from "react-hook-form";
import { clearAllWizardDrafts, useFormDraft } from "../useFormDraft";

function setup(storageKey: string, enabled = true) {
  const formHook = renderHook(() =>
    useForm<{ full_name: string; sex: string }>({
      defaultValues: { full_name: "", sex: "" },
    }),
  );
  const form = formHook.result.current;
  const draftHook = renderHook(() =>
    useFormDraft({
      storageKey,
      watch: form.watch,
      reset: form.reset,
      getValues: form.getValues,
      enabled,
    }),
  );
  return { form, draft: draftHook.result };
}

describe("useFormDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists form changes to localStorage under the shared wizard-draft: prefix", () => {
    const { form } = setup("resident-new:w1");
    act(() => {
      form.setValue("full_name", "Abebe Kebede");
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const raw = localStorage.getItem("wizard-draft:resident-new:w1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ full_name: "Abebe Kebede" });
  });

  it("restores a previously saved draft on mount", () => {
    localStorage.setItem(
      "wizard-draft:resident-new:w1",
      JSON.stringify({ full_name: "Restored Name", sex: "male" }),
    );
    const { form } = setup("resident-new:w1");
    expect(form.getValues("full_name")).toBe("Restored Name");
    expect(form.getValues("sex")).toBe("male");
  });

  it("does not restore or persist while disabled", () => {
    localStorage.setItem(
      "wizard-draft:resident-new:w1",
      JSON.stringify({ full_name: "Should Not Load", sex: "" }),
    );
    const { form } = setup("resident-new:w1", false);
    expect(form.getValues("full_name")).toBe("");
  });

  it("keeps drafts for different storage keys independent", () => {
    setup("resident-new:w1");
    const { form: form2 } = setup("resident-new:w2");
    act(() => {
      form2.setValue("full_name", "Woreda Two Draft");
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(localStorage.getItem("wizard-draft:resident-new:w1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("wizard-draft:resident-new:w2")!)).toMatchObject({
      full_name: "Woreda Two Draft",
    });
  });

  it("clearDraft removes only its own key", () => {
    const { form, draft } = setup("resident-new:w1");
    act(() => {
      form.setValue("full_name", "x");
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    localStorage.setItem("wizard-draft:other-wizard:w1", "{}");
    act(() => {
      draft.current.clearDraft();
    });
    expect(localStorage.getItem("wizard-draft:resident-new:w1")).toBeNull();
    expect(localStorage.getItem("wizard-draft:other-wizard:w1")).not.toBeNull();
  });

  it("survives a malformed/corrupt stored draft instead of throwing", () => {
    localStorage.setItem("wizard-draft:resident-new:w1", "{not valid json");
    expect(() => setup("resident-new:w1")).not.toThrow();
  });
});

describe("clearAllWizardDrafts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes every key under the wizard-draft: prefix and nothing else", () => {
    localStorage.setItem("wizard-draft:resident-new:w1", "{}");
    localStorage.setItem("wizard-draft:household-new:w2", "{}");
    localStorage.setItem("unrelated-key", "keep me");
    clearAllWizardDrafts();
    expect(localStorage.getItem("wizard-draft:resident-new:w1")).toBeNull();
    expect(localStorage.getItem("wizard-draft:household-new:w2")).toBeNull();
    expect(localStorage.getItem("unrelated-key")).toBe("keep me");
  });

  it("is a no-op when there are no drafts", () => {
    localStorage.setItem("unrelated-key", "keep me");
    expect(() => clearAllWizardDrafts()).not.toThrow();
    expect(localStorage.getItem("unrelated-key")).toBe("keep me");
  });
});
