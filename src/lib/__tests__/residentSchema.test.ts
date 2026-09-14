import { describe, expect, it } from "vitest";
import { residentSchema, residentCreateSchema } from "@/lib/residentSchema";

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Every required field on the base schema, none of them phone/photo. */
const baseValidFields = {
  first_name: "አበበ",
  full_name: "Abebe",
  father_name: "ከበደ",
  grandfather_name: "ተስፋዬ",
  mother_full_name: "አልማዝ",
  sex: "male" as const,
  date_of_birth: "1990-01-01",
  ethnicity: "oromo",
  religion: "orthodox",
};

describe("residentSchema (edit/base) vs residentCreateSchema (intake) -- Task 8 scoping", () => {
  it("base residentSchema does NOT require photo_url or phone_digits -- an existing resident (e.g. a newborn with neither) stays editable", () => {
    const result = residentSchema.safeParse(baseValidFields);
    expect(result.success).toBe(true);
  });

  it("residentCreateSchema rejects the same input for a missing photo", () => {
    const result = residentCreateSchema.safeParse(baseValidFields);
    expect(result.success).toBe(false);
    if (!result.success) {
      const photoIssue = result.error.issues.find((i) => i.path[0] === "photo_url");
      expect(photoIssue).toBeDefined();
    }
  });

  it("residentCreateSchema rejects the same input for a missing phone", () => {
    const result = residentCreateSchema.safeParse({
      ...baseValidFields,
      photo_url: "some/path.jpg",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const phoneIssue = result.error.issues.find((i) => i.path[0] === "phone_digits");
      expect(phoneIssue).toBeDefined();
    }
  });

  it("residentCreateSchema accepts a complete intake with photo + valid phone", () => {
    const result = residentCreateSchema.safeParse({
      ...baseValidFields,
      photo_url: "some/path.jpg",
      phone_digits: "911234567",
    });
    expect(result.success).toBe(true);
  });

  it("date_of_birth still can't be in the future on either schema", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(future > todayIso()).toBe(true);
    const result = residentSchema.safeParse({ ...baseValidFields, date_of_birth: future });
    expect(result.success).toBe(false);
  });
});
