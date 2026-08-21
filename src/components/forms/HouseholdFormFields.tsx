import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Controller,
  type Control,
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from "react-hook-form";
import { Home as HomeIcon, Users as UsersIcon, Phone, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Section, Grid, FieldWrap, Select } from "@/components/forms/FormSection";
import { ResidentSearchPicker } from "@/components/forms/ResidentSearchPicker";
import { supabase } from "@/integrations/supabase/client";
import type { HouseholdFormInput } from "@/lib/householdSchema";

const LocationPickerMap = lazy(() => import("@/components/gis/LocationPickerMap"));

interface Props {
  woredaId: string;
  control: Control<HouseholdFormInput>;
  register: UseFormRegister<HouseholdFormInput>;
  errors: FieldErrors<HouseholdFormInput>;
  setValue: UseFormSetValue<HouseholdFormInput>;
  watch: UseFormWatch<HouseholdFormInput>;
  /** When editing, kebele and house_number cannot be changed. */
  mode: "create" | "edit";
  /** Async check for house number uniqueness in selected kebele (create mode). */
  houseNumberError?: string | null;
  onHouseNumberBlur?: () => void;
}

export function HouseholdFormFields({
  woredaId,
  control,
  register,
  errors,
  setValue,
  watch,
  mode,
  houseNumberError,
  onHouseNumberBlur,
}: Props) {
  const kebelesQuery = useQuery({
    queryKey: ["kebeles", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele")
        .select("kebele_id, kebele_number, kebele_name_am, kebele_name_en")
        .eq("woreda_id", woredaId)
        .order("kebele_number");
      if (error) throw error;
      return data;
    },
  });

  const houseType = watch("house_type");
  const phoneDigits = watch("phone_digits");

  // Reset house_type_other when not Other
  useEffect(() => {
    if (houseType !== "other") {
      setValue("house_type_other", "", { shouldDirty: true });
    }
    if (houseType !== "rental" && houseType !== "rented_by_private") {
      setValue("rent_amount", "", { shouldDirty: true });
    }
  }, [houseType, setValue]);

  const handlePhoneChange = (raw: string) => {
    let v = raw.replace(/\D/g, "");
    if (v.startsWith("0")) v = v.slice(1);
    if (v.length > 9) v = v.slice(0, 9);
    setValue("phone_digits", v, { shouldDirty: true, shouldValidate: false });
  };

  return (
    <>
      {/* SECTION A — Basic Information */}
      <Section icon={HomeIcon} titleAm="መሰረታዊ መረጃ" titleEn="Basic Information">
        <Grid>
          <FieldWrap
            labelAm="ቀበሌ"
            labelEn="Kebele"
            required
            error={errors.kebele_id?.message}
            helper={
              mode === "edit"
                ? "ቀበሌ ከተመዘገበ በኋላ ሊቀየር አይችልም / Kebele cannot be changed after registration"
                : undefined
            }
          >
            {mode === "edit" ? (
              <div className="font-noto-ethiopic flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                {(() => {
                  const id = watch("kebele_id");
                  const k = kebelesQuery.data?.find((x) => x.kebele_id === id);
                  return k ? `${k.kebele_number} — ${k.kebele_name_am}` : "—";
                })()}
              </div>
            ) : (
              <Select {...register("kebele_id")}>
                <option value="">— ይምረጡ / Select —</option>
                {(kebelesQuery.data ?? []).map((k) => (
                  <option key={k.kebele_id} value={k.kebele_id}>
                    {k.kebele_number} — {k.kebele_name_am}
                  </option>
                ))}
              </Select>
            )}
          </FieldWrap>

          <FieldWrap
            labelAm="የቤት ቁጥር"
            labelEn="House Number"
            required
            error={errors.house_number?.message ?? houseNumberError ?? undefined}
            helper={
              mode === "edit"
                ? "የቤት ቁጥር ከተመዘገበ በኋላ ሊቀየር አይችልም / Cannot be changed after registration"
                : undefined
            }
          >
            {mode === "edit" ? (
              <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-700">
                {watch("house_number") || "—"}
              </div>
            ) : (
              <Input
                {...register("house_number", { onBlur: () => onHouseNumberBlur?.() })}
                placeholder="e.g. 015A"
                className="font-mono"
              />
            )}
          </FieldWrap>

          <FieldWrap
            labelAm="አድራሻ"
            labelEn="Address Line"
            error={errors.address_line?.message}
            colSpan2
          >
            <Input
              {...register("address_line")}
              placeholder="የመንገድ ስም፣ ምልክት / Street, landmark"
              className="font-noto-ethiopic"
            />
          </FieldWrap>

          <FieldWrap
            labelAm="አያያዝ ሁኔታ"
            labelEn="Occupancy Status"
            required
            error={errors.occupancy_status?.message}
          >
            <Select {...register("occupancy_status")}>
              <option value="occupied">ተይዟል / Occupied</option>
              <option value="vacant">ባዶ / Vacant</option>
              <option value="demolished">ፈርሷል / Demolished</option>
              <option value="transferred">ተዛውሯል / Transferred</option>
            </Select>
          </FieldWrap>

          <FieldWrap labelAm="ንዑስ ወረዳ" labelEn="Sub-Woreda" error={errors.sub_woreda?.message}>
            <Input {...register("sub_woreda")} className="font-noto-ethiopic" />
          </FieldWrap>
        </Grid>

        <div className="mt-4">
          <FieldWrap
            labelAm="የቤት መገኛ አካባቢ"
            labelEn="House Location"
            required
            error={errors.gps_lat?.message ?? errors.gps_lng?.message}
            helper="ካርታውን ይንኩ ወይም ምልክቱን ይጎትቱ የቤቱን ትክክለኛ መገኛ ለማመልከት / Tap the map or drag the marker to mark the exact house location"
          >
            <Controller
              name="gps_lat"
              control={control}
              render={({ field: latField }) => (
                <Controller
                  name="gps_lng"
                  control={control}
                  render={({ field: lngField }) => (
                    <Suspense fallback={<Skeleton className="h-[340px] w-full" />}>
                      <LocationPickerMap
                        latitude={(latField.value as number | null | undefined) ?? null}
                        longitude={(lngField.value as number | null | undefined) ?? null}
                        onChange={(lat, lng) => {
                          latField.onChange(lat);
                          lngField.onChange(lng);
                        }}
                      />
                    </Suspense>
                  )}
                />
              )}
            />
          </FieldWrap>
        </div>
      </Section>

      {/* SECTION B — Family Links */}
      <Section
        icon={UsersIcon}
        titleAm="የቤተሰብ ኃላፊ"
        titleEn="Household Head & Family Links"
        helper="ኃላፊው ካልተመዘገበ ቀደም ብሎ ይመዝግቡ / Register the head first if not yet in the system"
      >
        <Grid>
          <FieldWrap
            labelAm="የቤተሰብ ተጠሪ"
            labelEn="Household Head"
            error={errors.household_head_resident_id?.message}
          >
            <Controller
              name="household_head_resident_id"
              control={control}
              render={({ field }) => (
                <ResidentSearchPicker
                  value={field.value ?? ""}
                  onChange={(id) => field.onChange(id)}
                  woredaId={woredaId}
                />
              )}
            />
            <a
              href="/woreda/residents/new"
              target="_blank"
              rel="noopener noreferrer"
              className="font-noto-ethiopic mt-1 inline-block text-xs text-blue-700 hover:underline"
            >
              + አዲስ ነዋሪ መዝግብ / Register a new resident
            </a>
          </FieldWrap>

          <FieldWrap labelAm="የባል/የሚስት" labelEn="Spouse" error={errors.spouse_resident_id?.message}>
            <Controller
              name="spouse_resident_id"
              control={control}
              render={({ field }) => (
                <ResidentSearchPicker
                  value={field.value ?? ""}
                  onChange={(id) => field.onChange(id)}
                  woredaId={woredaId}
                  excludeResidentIds={[watch("household_head_resident_id") ?? ""].filter(Boolean)}
                />
              )}
            />
          </FieldWrap>

          <FieldWrap
            labelAm="ሌላ የቤተሰብ ተጠሪ"
            labelEn="Alternate Head"
            error={errors.alternate_head_resident_id?.message}
            colSpan2
          >
            <Controller
              name="alternate_head_resident_id"
              control={control}
              render={({ field }) => (
                <ResidentSearchPicker
                  value={field.value ?? ""}
                  onChange={(id) => field.onChange(id)}
                  woredaId={woredaId}
                  excludeResidentIds={[
                    watch("household_head_resident_id") ?? "",
                    watch("spouse_resident_id") ?? "",
                  ].filter(Boolean)}
                />
              )}
            />
          </FieldWrap>
        </Grid>
      </Section>

      {/* SECTION C — Contact */}
      <Section icon={Phone} titleAm="እውቂያ" titleEn="Contact">
        <Grid>
          <FieldWrap labelAm="ስልክ ቁጥር" labelEn="Phone Number" error={errors.phone_digits?.message}>
            <div className="flex">
              <span className="font-mono inline-flex h-10 items-center rounded-l-md border border-r-0 border-input bg-slate-50 px-3 text-sm text-slate-600">
                +251
              </span>
              <Input
                value={phoneDigits ?? ""}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="9XXXXXXXX"
                inputMode="numeric"
                className="rounded-l-none font-mono"
              />
            </div>
          </FieldWrap>

          <FieldWrap labelAm="ፖሳቁ" labelEn="PO Box" error={errors.po_box?.message}>
            <Input {...register("po_box")} />
          </FieldWrap>

          <FieldWrap labelAm="ኢሜይል" labelEn="Email" error={errors.email?.message} colSpan2>
            <Input type="email" {...register("email")} placeholder="name@example.com" />
          </FieldWrap>
        </Grid>
      </Section>

      {/* SECTION D — Housing Type */}
      <Section icon={Building2} titleAm="የቤት ሁኔታ" titleEn="Housing Type">
        <div className="space-y-4">
          <FieldWrap
            labelAm="የቤቱ ባለንብረት"
            labelEn="House Type"
            required
            error={errors.house_type?.message}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { v: "private", am: "የግል", en: "Private" },
                { v: "kebele", am: "የቀበሌ", en: "Kebele" },
                { v: "rental", am: "የኪራይ ቤቶች", en: "Rental Houses" },
                { v: "government", am: "የመንግስት", en: "Government" },
                { v: "rented_by_private", am: "ኪራይ (በግለሰብ)", en: "Rented by Private" },
                { v: "other", am: "ሌላ", en: "Other" },
              ].map((opt) => (
                <label
                  key={opt.v}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition ${
                    houseType === opt.v
                      ? "border-blue-600 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    value={opt.v}
                    {...register("house_type")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-noto-ethiopic font-medium text-slate-800">{opt.am}</div>
                    <div className="text-xs text-slate-500">{opt.en}</div>
                  </div>
                </label>
              ))}
            </div>
          </FieldWrap>

          {houseType === "other" && (
            <FieldWrap
              labelAm="ሌላ (ይግለፁ)"
              labelEn="Specify Other"
              required
              error={errors.house_type_other?.message}
            >
              <Input {...register("house_type_other")} className="font-noto-ethiopic" />
            </FieldWrap>
          )}

          {(houseType === "rental" || houseType === "rented_by_private") && (
            <FieldWrap
              labelAm="የኪራይ ብር መጠን"
              labelEn="Rent Amount (ETB)"
              required
              error={errors.rent_amount?.message}
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register("rent_amount")}
                placeholder="0.00"
                className="font-mono"
              />
            </FieldWrap>
          )}
        </div>
      </Section>
    </>
  );
}
