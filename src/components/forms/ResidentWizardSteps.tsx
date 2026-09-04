import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UserCircle2,
  HomeIcon,
  MapPin,
  GraduationCap,
  CalendarClock,
  History,
  Upload,
  Loader2,
  AlertCircle,
  X,
  Check,
  FileText,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { EthiopianDateInput } from "@/components/common/EthiopianDateInput";
import { Section, Grid, FieldWrap, Select } from "@/components/forms/FormSection";
import { PhoneDigitsInput } from "@/components/forms/PhoneDigitsInput";
import { supabase } from "@/integrations/supabase/client";
import { toWebp, storageExtension, PHOTO_WEBP } from "@/utils/imageCompression";
import { useWoredaInfo } from "@/hooks/useWoredaInfo";
import {
  EDUCATION_OPTIONS,
  ETHIOPIAN_REGIONS,
  ETHNICITY_OPTIONS,
  OCCUPATION_OPTIONS,
  RELIGION_OPTIONS,
} from "@/lib/residentConstants";
import {
  RESIDENT_STEPS,
  type ResidentFormInput,
  type ResidentFormValues,
} from "@/lib/residentSchema";

const DocumentViewerDialog = lazy(() => import("@/components/common/DocumentViewerDialog"));

interface Props {
  form: UseFormReturn<ResidentFormInput, unknown, ResidentFormValues>;
  step: number;
  maxReached: number;
  onJumpStep: (n: number) => void;
  woredaId: string | null;
  /** Resident ID to exclude in duplicate FAN checks (edit mode). */
  excludeResidentId?: string;
  /** Read-only resident number displayed on Step 1 (edit mode). */
  residentNumber?: string;
}

export function ResidentWizardSteps({
  form,
  step,
  maxReached,
  onJumpStep,
  woredaId,
  excludeResidentId,
  residentNumber,
}: Props) {
  const woredaInfo = useWoredaInfo();
  const {
    register,
    formState: { errors },
    control,
    setValue,
    watch,
  } = form;

  const [duplicateIdWarning, setDuplicateIdWarning] = useState<string | null>(null);
  const [householdSearch, setHouseholdSearch] = useState("");

  // ----- Household search -----
  const householdQuery = useQuery({
    queryKey: ["household-search", woredaId, householdSearch],
    enabled: !!woredaId && householdSearch.length >= 1,
    queryFn: async () => {
      const term = householdSearch.replace(/[%,]/g, "");
      const { data, error } = await supabase
        .from("household")
        .select("household_id, house_number, kebele:kebele_id(kebele_name_am, kebele_number)")
        .eq("woreda_id", woredaId as string)
        .ilike("house_number", `%${term}%`)
        .limit(15);
      if (error) throw error;
      return data;
    },
  });

  const selectedHouseholdId = watch("current_household_id");
  const [selectedHouseholdLabel, setSelectedHouseholdLabel] = useState("");
  const [selectedHouseholdData, setSelectedHouseholdData] = useState<{
    house_number: string;
    kebele_name_am?: string;
    kebele_number?: string;
  } | null>(null);

  // When editing, resolve the currently-assigned household for display.
  useEffect(() => {
    if (!selectedHouseholdId || selectedHouseholdLabel) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("household")
        .select("house_number, kebele:kebele_id(kebele_name_am, kebele_number)")
        .eq("household_id", selectedHouseholdId)
        .maybeSingle();
      if (cancelled || !data) return;
      const k = data.kebele as { kebele_name_am: string; kebele_number: string } | null;
      const label = `#${data.house_number}${k ? ` — ${k.kebele_number} ${k.kebele_name_am}` : ""}`;
      setSelectedHouseholdLabel(label);
      setSelectedHouseholdData({
        house_number: data.house_number,
        kebele_name_am: k?.kebele_name_am,
        kebele_number: k?.kebele_number,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedHouseholdId, selectedHouseholdLabel]);

  // ----- FAN duplicate check -----
  const nationalId = watch("national_id_no");
  const idCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (idCheckTimer.current) clearTimeout(idCheckTimer.current);
    if (!nationalId || nationalId.trim().length < 3 || !woredaId) {
      setDuplicateIdWarning(null);
      return;
    }
    idCheckTimer.current = setTimeout(async () => {
      let q = supabase
        .from("resident")
        .select("resident_id, resident_number")
        .eq("woreda_id", woredaId)
        .eq("national_id_no", nationalId.trim())
        .limit(1);
      if (excludeResidentId) q = q.neq("resident_id", excludeResidentId);
      const { data } = await q;
      if (data && data.length > 0) {
        setDuplicateIdWarning(
          `ይህ የመታወቂያ ቁጥር ቀደም ሲል ተመዝግቧል (${data[0].resident_number}) / Already registered in this woreda`,
        );
      } else {
        setDuplicateIdWarning(null);
      }
    }, 500);
    return () => {
      if (idCheckTimer.current) clearTimeout(idCheckTimer.current);
    };
  }, [nationalId, woredaId, excludeResidentId]);

  // ----- Photo upload -----
  const photoUrl = watch("photo_url");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      if (!photoUrl) {
        setPhotoPreview(null);
        return;
      }
      const { data } = await supabase.storage
        .from("resident-photos")
        .createSignedUrl(photoUrl, 600);
      if (!cancelled) setPhotoPreview(data?.signedUrl ?? null);
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  const handlePhotoUpload = async (file: File) => {
    if (!woredaId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("ፎቶ ከ5MB መብለጥ የለበትም / Photo must be under 5MB");
      return;
    }
    setUploadingPhoto(true);
    try {
      // Camera photos are several megabytes; WebP takes them to a fraction of
      // that before the upload starts. The size check above still runs against
      // the original, so a huge file is rejected rather than quietly shrunk.
      const upload = await toWebp(file, PHOTO_WEBP);
      const path = `${woredaId}/${crypto.randomUUID()}.${storageExtension(upload, "jpg")}`;
      const { error } = await supabase.storage
        .from("resident-photos")
        .upload(path, upload, { upsert: false, contentType: upload.type });
      if (error) throw error;
      setValue("photo_url", path, { shouldDirty: true });
      toast.success("ፎቶ ተጭኗል / Photo uploaded");
    } catch (e) {
      toast.error(`ፎቶ መጫን አልተሳካም / Upload failed: ${(e as Error).message}`);
    } finally {
      setUploadingPhoto(false);
    }
  };

  // ----- Clearance letter upload -----
  const clearanceUrl = watch("fr_clearance_letter_url");
  const [clearanceFileName, setClearanceFileName] = useState<string>("");
  const [clearancePreview, setClearancePreview] = useState<string | null>(null);
  const [uploadingClearance, setUploadingClearance] = useState(false);
  const [clearanceViewerUrl, setClearanceViewerUrl] = useState<string | null>(null);
  const [clearanceViewerOpen, setClearanceViewerOpen] = useState(false);
  const [openingClearanceViewer, setOpeningClearanceViewer] = useState(false);
  const isClearancePdf = /\.pdf$/i.test(clearanceUrl ?? "");

  const openClearanceViewer = async () => {
    if (!clearanceUrl) return;
    setOpeningClearanceViewer(true);
    try {
      const { data, error } = await supabase.storage
        .from("resident-clearance-letters")
        .createSignedUrl(clearanceUrl, 600);
      if (error || !data?.signedUrl) {
        toast.error("ፋይሉን መክፈት አልተቻለም / Could not open the file");
        return;
      }
      setClearanceViewerUrl(data.signedUrl);
      setClearanceViewerOpen(true);
    } finally {
      setOpeningClearanceViewer(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      if (!clearanceUrl) {
        setClearancePreview(null);
        return;
      }
      const isImg = /\.(jpe?g|png)$/i.test(clearanceUrl);
      if (!isImg) {
        setClearancePreview(null);
        return;
      }
      const { data } = await supabase.storage
        .from("resident-clearance-letters")
        .createSignedUrl(clearanceUrl, 600);
      if (!cancelled) setClearancePreview(data?.signedUrl ?? null);
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [clearanceUrl]);

  const handleClearanceUpload = async (file: File) => {
    if (!woredaId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("ፋይል ከ5MB መብለጥ የለበትም / File must be under 5MB");
      return;
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.type)) {
      toast.error("PDF፣ JPG ወይም PNG ብቻ / Only PDF, JPG or PNG");
      return;
    }
    setUploadingClearance(true);
    try {
      const ext = file.name.split(".").pop() ?? "pdf";
      const path = `${woredaId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("resident-clearance-letters")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      setValue("fr_clearance_letter_url", path, { shouldDirty: true });
      setClearanceFileName(file.name);
      toast.success("ክሊራንስ ደብዳቤ ተጭኗል / Clearance letter uploaded");
    } catch (e) {
      toast.error(`ፋይል መጫን አልተሳካም / Upload failed: ${(e as Error).message}`);
    } finally {
      setUploadingClearance(false);
    }
  };

  // ----- Phone -----
  const phoneDigits = watch("phone_digits");
  const handlePhoneChange = (digits: string) => {
    setValue("phone_digits", digits, { shouldDirty: true, shouldValidate: true });
  };

  // ----- Birth-place "same as current" autofill -----
  const bpSame = watch("bp_same_as_current");
  useEffect(() => {
    if (bpSame !== "yes") return;
    setValue("bp_region", "Harari", { shouldDirty: true });
    setValue("bp_woreda", woredaInfo.data?.woreda_name_en ?? "", { shouldDirty: true });
    if (selectedHouseholdData) {
      const k =
        selectedHouseholdData.kebele_number && selectedHouseholdData.kebele_name_am
          ? `${selectedHouseholdData.kebele_number} — ${selectedHouseholdData.kebele_name_am}`
          : "";
      setValue("bp_kebele", k, { shouldDirty: true });
      setValue("bp_house_number", selectedHouseholdData.house_number ?? "", { shouldDirty: true });
    } else {
      setValue("bp_kebele", "", { shouldDirty: true });
      setValue("bp_house_number", "", { shouldDirty: true });
    }
    setValue("bp_zone", "", { shouldDirty: true });
    setValue("bp_place_name", "", { shouldDirty: true });
    setValue("bp_area_name", "", { shouldDirty: true });
  }, [bpSame, woredaInfo.data?.woreda_name_en, selectedHouseholdData, setValue]);

  const hasFormer = watch("has_former_residence");
  const bpReadonly = bpSame === "yes";

  return (
    <>
      <StepIndicator step={step} maxReached={maxReached} onJump={onJumpStep} />

      {/* Step 1: Identity */}
      <div className={step === 1 ? "" : "hidden"}>
        <Section icon={UserCircle2} titleAm="የግል መረጃ" titleEn="Identity">
          {residentNumber && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <span className="font-noto-ethiopic text-slate-600">የመዝገብ ቁጥር / Resident #:</span>
              <span className="font-mono font-semibold text-blue-800">{residentNumber}</span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
            <Grid>
              <FieldWrap
                labelAm="የመጀመሪያ ስም"
                labelEn="First Name"
                required
                error={errors.first_name?.message}
              >
                <Input className="font-noto-ethiopic" {...register("first_name")} />
              </FieldWrap>
              <FieldWrap
                labelAm="ሙሉ ስም (እንግሊዘኛ)"
                labelEn="Full Name (English)"
                required
                error={errors.full_name?.message}
              >
                <Input {...register("full_name")} />
              </FieldWrap>
              <FieldWrap
                labelAm="የአባት ስም"
                labelEn="Father's Name"
                required
                error={errors.father_name?.message}
              >
                <Input className="font-noto-ethiopic" {...register("father_name")} />
              </FieldWrap>
              <FieldWrap
                labelAm="የወንድ አያት ስም"
                labelEn="Grandfather's Name"
                required
                error={errors.grandfather_name?.message}
              >
                <Input className="font-noto-ethiopic" {...register("grandfather_name")} />
              </FieldWrap>
              <FieldWrap
                labelAm="የእናት ስም"
                labelEn="Mother's Full Name"
                required
                error={errors.mother_full_name?.message}
              >
                <Input className="font-noto-ethiopic" {...register("mother_full_name")} />
              </FieldWrap>
              <FieldWrap labelAm="ፆታ" labelEn="Gender" required error={errors.sex?.message}>
                <div className="flex gap-4 pt-2">
                  <label className="font-noto-ethiopic flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="male"
                      {...register("sex")}
                      className="accent-blue-700"
                    />{" "}
                    ወንድ / Male
                  </label>
                  <label className="font-noto-ethiopic flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="female"
                      {...register("sex")}
                      className="accent-blue-700"
                    />{" "}
                    ሴት / Female
                  </label>
                </div>
              </FieldWrap>
              <FieldWrap
                labelAm="የትውልድ ቀን"
                labelEn="Date of Birth (Ethiopian)"
                required
                error={errors.date_of_birth?.message}
              >
                <Controller
                  control={control}
                  name="date_of_birth"
                  render={({ field }) => (
                    <EthiopianDateInput value={field.value ?? ""} onChange={field.onChange} />
                  )}
                />
              </FieldWrap>
              <FieldWrap
                labelAm="ኃይማኖት"
                labelEn="Religion"
                required
                error={errors.religion?.message}
              >
                <Select {...register("religion")}>
                  <option value="">— ይምረጡ / Select —</option>
                  {RELIGION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.am} / {o.en}
                    </option>
                  ))}
                </Select>
              </FieldWrap>
              <FieldWrap
                labelAm="ስልክ ቁጥር"
                labelEn="Phone Number"
                error={errors.phone_digits?.message}
              >
                <PhoneDigitsInput value={phoneDigits ?? ""} onChange={handlePhoneChange} />
              </FieldWrap>
              <FieldWrap
                labelAm="ብሔር"
                labelEn="Ethnicity"
                required
                error={errors.ethnicity?.message}
              >
                <Select {...register("ethnicity")}>
                  <option value="">— ይምረጡ / Select —</option>
                  {ETHNICITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.am} / {o.en}
                    </option>
                  ))}
                </Select>
              </FieldWrap>
              <FieldWrap labelAm="ኢሜይል" labelEn="Email">
                <Input type="email" placeholder="name@example.com" disabled />
              </FieldWrap>
              <FieldWrap
                labelAm="ብሔራዊ መታወቂያ (ፋይዳ) ቁጥር"
                labelEn="National ID FAN Number"
                colSpan2
                error={errors.national_id_no?.message}
              >
                <Input inputMode="numeric" maxLength={16} {...register("national_id_no")} />
                {duplicateIdWarning && (
                  <div className="font-noto-ethiopic mt-1 flex items-start gap-1 text-xs text-amber-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{duplicateIdWarning}</span>
                  </div>
                )}
              </FieldWrap>
            </Grid>

            <div className="flex flex-col items-center gap-3 lg:items-stretch">
              <div className="mx-auto flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 lg:mx-0 lg:h-44 lg:w-full">
                {photoPreview ? (
                  <div className="relative h-full w-full">
                    <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setValue("photo_url", "")}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <UserCircle2 className="h-20 w-20 text-slate-300" />
                )}
              </div>
              <div className="w-full space-y-2">
                <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {uploadingPhoto ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span className="font-noto-ethiopic">ፎቶ ጫን / Upload Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePhotoUpload(f);
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </Section>
      </div>

      {/* Step 2 */}
      <div className={step === 2 ? "space-y-6" : "hidden"}>
        <Section
          icon={HomeIcon}
          titleAm="የአሁኑ መኖሪያ"
          titleEn="Current Residence"
          helper="ክልል/ከተማ/ወረዳ/ቀበሌ/ቤት ቁጥር ከተመረጠው ቤተሰብ ይወሰዳል / Region, City, Woreda, Kebele, House Number are taken from the selected household"
        >
          <Grid>
            <FieldWrap labelAm="ቤተሰብ" labelEn="Household">
              <div className="space-y-2">
                <Input
                  placeholder="በቤት ቁጥር ይፈልጉ / Search by house number"
                  value={householdSearch}
                  onChange={(e) => setHouseholdSearch(e.target.value)}
                  className="font-noto-ethiopic"
                />
                {selectedHouseholdId && (
                  <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                    <span className="font-noto-ethiopic">{selectedHouseholdLabel}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setValue("current_household_id", "");
                        setSelectedHouseholdLabel("");
                        setSelectedHouseholdData(null);
                      }}
                      className="text-blue-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {!selectedHouseholdId &&
                  householdSearch &&
                  (householdQuery.data?.length ?? 0) > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white">
                      {householdQuery.data?.map((h) => {
                        const k = h.kebele as {
                          kebele_name_am: string;
                          kebele_number: string;
                        } | null;
                        const label = `#${h.house_number}${k ? ` — ${k.kebele_number} ${k.kebele_name_am}` : ""}`;
                        return (
                          <button
                            key={h.household_id}
                            type="button"
                            className="font-noto-ethiopic block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                            onClick={() => {
                              setValue("current_household_id", h.household_id, {
                                shouldDirty: true,
                              });
                              setSelectedHouseholdLabel(label);
                              setSelectedHouseholdData({
                                house_number: h.house_number,
                                kebele_name_am: k?.kebele_name_am,
                                kebele_number: k?.kebele_number,
                              });
                              setHouseholdSearch("");
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>
            </FieldWrap>
            <FieldWrap labelAm="ዝምድና ከቤተሰብ ኃላፊ ጋር" labelEn="Relation to Household Head">
              <Input className="font-noto-ethiopic" {...register("relation_to_head")} />
            </FieldWrap>
            <FieldWrap labelAm="ንኡስ ወረዳ" labelEn="Sub-Woreda">
              <Input className="font-noto-ethiopic" {...register("sub_woreda")} />
            </FieldWrap>
            <FieldWrap labelAm="ኬክሮስ" labelEn="Latitude">
              <Input type="number" step="any" {...register("latitude")} />
            </FieldWrap>
            <FieldWrap labelAm="ኬንትሮስ" labelEn="Longitude">
              <Input type="number" step="any" {...register("longitude")} />
            </FieldWrap>
            <FieldWrap labelAm="ሌላ የመኖሪያ አድራሻ ካለ" labelEn="Other Residence Address" colSpan2>
              <Textarea className="font-noto-ethiopic" rows={2} {...register("other_address")} />
            </FieldWrap>
          </Grid>
        </Section>

        <Section icon={MapPin} titleAm="የትውልድ ሥፍራ" titleEn="Place of Birth">
          <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="font-noto-ethiopic mb-2 text-sm font-medium text-slate-700">
              የትውልድ ሥፍራ ከአሁኑ መኖሪያ ጋር ተመሳሳይ ነው? / Same as current residence?
            </p>
            <div className="flex gap-4">
              <label className="font-noto-ethiopic flex items-center gap-2 text-sm">
                <input type="radio" value="yes" {...register("bp_same_as_current")} /> አዎ / Yes
              </label>
              <label className="font-noto-ethiopic flex items-center gap-2 text-sm">
                <input type="radio" value="no" {...register("bp_same_as_current")} /> አይደለም / No
              </label>
            </div>
          </div>
          <Grid>
            <FieldWrap labelAm="የትውልድ ሥፍራ ስም" labelEn="Place Name">
              <Input
                className="font-noto-ethiopic"
                disabled={bpReadonly}
                {...register("bp_place_name")}
              />
            </FieldWrap>
            <FieldWrap labelAm="ክልል" labelEn="Region">
              <Select disabled={bpReadonly} {...register("bp_region")}>
                <option value="">—</option>
                {ETHIOPIAN_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </FieldWrap>
            <FieldWrap labelAm="ዞን" labelEn="Zone">
              <Input
                className="font-noto-ethiopic"
                disabled={bpReadonly}
                {...register("bp_zone")}
              />
            </FieldWrap>
            <FieldWrap labelAm="ወረዳ" labelEn="Woreda">
              <Input
                className="font-noto-ethiopic"
                disabled={bpReadonly}
                {...register("bp_woreda")}
              />
            </FieldWrap>
            <FieldWrap labelAm="ቀበሌ" labelEn="Kebele">
              <Input
                className="font-noto-ethiopic"
                disabled={bpReadonly}
                {...register("bp_kebele")}
              />
            </FieldWrap>
            <FieldWrap labelAm="የቤት ቁጥር" labelEn="House Number">
              <Input disabled={bpReadonly} {...register("bp_house_number")} />
            </FieldWrap>
            <FieldWrap labelAm="ልዩ ቦታ" labelEn="Area Name">
              <Input
                className="font-noto-ethiopic"
                disabled={bpReadonly}
                {...register("bp_area_name")}
              />
            </FieldWrap>
          </Grid>
        </Section>
      </div>

      {/* Step 3 */}
      <div className={step === 3 ? "" : "hidden"}>
        <Section icon={GraduationCap} titleAm="የትምህርትና ሥራ መረጃ" titleEn="Education and Occupation">
          <Grid>
            <FieldWrap labelAm="የትምህርት ደረጃ" labelEn="Education Level">
              <Select {...register("wi_education_level")}>
                <option value="">—</option>
                {EDUCATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.am} / {o.en}
                  </option>
                ))}
              </Select>
            </FieldWrap>
            <FieldWrap labelAm="የሥራ ሁኔታ" labelEn="Occupation Status">
              <Select {...register("wi_occupation_status")}>
                <option value="">—</option>
                {OCCUPATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.am} / {o.en}
                  </option>
                ))}
              </Select>
            </FieldWrap>
            <FieldWrap labelAm="የሥራ ድርሽ" labelEn="Position">
              <Input className="font-noto-ethiopic" {...register("wi_occupation_post")} />
            </FieldWrap>
            <FieldWrap labelAm="የሥራ አድራሻ" labelEn="Work Address">
              <Input className="font-noto-ethiopic" {...register("wi_work_address")} />
            </FieldWrap>
            <FieldWrap labelAm="ክልል" labelEn="Region">
              <Input className="font-noto-ethiopic" {...register("wi_region")} />
            </FieldWrap>
            <FieldWrap labelAm="ዞን" labelEn="Zone">
              <Input className="font-noto-ethiopic" {...register("wi_zone")} />
            </FieldWrap>
            <FieldWrap labelAm="ወረዳ" labelEn="Woreda">
              <Input className="font-noto-ethiopic" {...register("wi_woreda")} />
            </FieldWrap>
            <FieldWrap labelAm="ቀበሌ" labelEn="Kebele">
              <Input className="font-noto-ethiopic" {...register("wi_kebele")} />
            </FieldWrap>
            <FieldWrap labelAm="የቤት ቁጥር" labelEn="House Number">
              <Input {...register("wi_house_number")} />
            </FieldWrap>
            <FieldWrap labelAm="ልዩ ቦታ" labelEn="Area Name">
              <Input className="font-noto-ethiopic" {...register("wi_area_name")} />
            </FieldWrap>
            <FieldWrap labelAm="ሌላ የሥራ አድራሻ ካለ" labelEn="Other Address" colSpan2>
              <Textarea className="font-noto-ethiopic" rows={2} {...register("wi_other_address")} />
            </FieldWrap>
          </Grid>
        </Section>
      </div>

      {/* Step 4 */}
      <div className={step === 4 ? "space-y-6" : "hidden"}>
        <Section icon={CalendarClock} titleAm="የመኖሪያ ጊዜ" titleEn="Residency Time">
          <Grid>
            <FieldWrap
              labelAm="በቀበሌ መኖር የጀመሩበት ጊዜ"
              labelEn="Residency Start Date"
              error={errors.residency_start_date?.message}
            >
              <Controller
                control={control}
                name="residency_start_date"
                render={({ field }) => (
                  <EthiopianDateInput value={field.value ?? ""} onChange={field.onChange} />
                )}
              />
            </FieldWrap>
          </Grid>
        </Section>

        <Section icon={History} titleAm="የቀድሞ አድራሻ" titleEn="Former Residence">
          <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="font-noto-ethiopic mb-2 text-sm font-medium text-slate-700">
              የቀድሞ መኖሪያ አለ? / Did you have a former residence?
            </p>
            <div className="flex gap-4">
              <label className="font-noto-ethiopic flex items-center gap-2 text-sm">
                <input type="radio" value="yes" {...register("has_former_residence")} /> አዎ / Yes
              </label>
              <label className="font-noto-ethiopic flex items-center gap-2 text-sm">
                <input type="radio" value="no" {...register("has_former_residence")} /> የለም / No
              </label>
            </div>
          </div>

          {hasFormer === "yes" && (
            <Grid>
              <FieldWrap labelAm="የቀድሞ አድራሻ" labelEn="Former Address" colSpan2>
                <Input className="font-noto-ethiopic" {...register("fr_address")} />
              </FieldWrap>
              <FieldWrap labelAm="ክልል" labelEn="Region">
                <Select {...register("fr_region")}>
                  <option value="">—</option>
                  {ETHIOPIAN_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </FieldWrap>
              <FieldWrap labelAm="ዞን" labelEn="Zone">
                <Input className="font-noto-ethiopic" {...register("fr_zone")} />
              </FieldWrap>
              <FieldWrap labelAm="ወረዳ" labelEn="Woreda">
                <Input className="font-noto-ethiopic" {...register("fr_woreda")} />
              </FieldWrap>
              <FieldWrap labelAm="ቀበሌ" labelEn="Kebele">
                <Input className="font-noto-ethiopic" {...register("fr_kebele")} />
              </FieldWrap>
              <FieldWrap labelAm="የቤት ቁጥር" labelEn="House Number">
                <Input {...register("fr_house_number")} />
              </FieldWrap>
              <FieldWrap labelAm="ልዩ ቦታ" labelEn="Area Name">
                <Input className="font-noto-ethiopic" {...register("fr_area_name")} />
              </FieldWrap>
              <FieldWrap
                labelAm="የክሊራንስ ደብዳቤ"
                labelEn="Clearance Letter"
                colSpan2
                helper="ካለፈው ቀበሌ/ወረዳ የተሰጠ የክሊራንስ ደብዳቤ ካለ ያያይዙ / Attach the clearance letter from the previous kebele/woreda, if available."
              >
                <div className="flex items-center gap-3">
                  {clearanceUrl ? (
                    <div className="relative flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      {clearancePreview ? (
                        <img
                          src={clearancePreview}
                          alt=""
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <FileText className="h-6 w-6 text-blue-700" />
                      )}
                      <span className="font-noto-ethiopic max-w-[200px] truncate">
                        {clearanceFileName || clearanceUrl.split("/").pop()}
                      </span>
                      {isClearancePdf && (
                        <button
                          type="button"
                          onClick={openClearanceViewer}
                          disabled={openingClearanceViewer}
                          className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50"
                        >
                          {openingClearanceViewer ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <span className="font-noto-ethiopic">ይመልከቱ</span>
                              <span className="ml-1 opacity-70">/ View</span>
                            </>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setValue("fr_clearance_letter_url", "");
                          setClearanceFileName("");
                        }}
                        className="ml-1 rounded-full bg-slate-200 p-0.5 text-slate-700 hover:bg-slate-300"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400">
                      <FileText className="h-6 w-6" />
                    </div>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
                    {uploadingClearance ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <span className="font-noto-ethiopic">
                      {clearanceUrl ? "ቀይር / Replace" : "ፋይል ጫን / Upload"}
                    </span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleClearanceUpload(f);
                      }}
                    />
                  </label>
                </div>
              </FieldWrap>
            </Grid>
          )}
        </Section>
      </div>
      {clearanceViewerOpen && (
        <Suspense fallback={null}>
          <DocumentViewerDialog
            open={clearanceViewerOpen}
            onOpenChange={setClearanceViewerOpen}
            signedUrl={clearanceViewerUrl}
            title={clearanceFileName || (clearanceUrl?.split("/").pop() ?? "Document")}
          />
        </Suspense>
      )}
    </>
  );
}

function StepIndicator({
  step,
  maxReached,
  onJump,
}: {
  step: number;
  maxReached: number;
  onJump: (n: number) => void;
}) {
  return (
    <Card className="border-slate-200 p-4 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="font-noto-ethiopic text-sm font-semibold text-slate-700">
          ደረጃ {step} ከ 4 <span className="font-normal opacity-60">/ Step {step} of 4</span>
        </p>
        <p className="font-noto-ethiopic text-sm font-medium text-blue-700">
          {RESIDENT_STEPS[step - 1].am}{" "}
          <span className="opacity-70">/ {RESIDENT_STEPS[step - 1].en}</span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        {RESIDENT_STEPS.map((s, i) => {
          const isDone = s.num < step;
          const isCurrent = s.num === step;
          const reachable = s.num <= maxReached;
          return (
            <div key={s.num} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                disabled={!reachable || isCurrent}
                onClick={() => onJump(s.num)}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${
                  isCurrent
                    ? "bg-blue-700 text-white shadow-md ring-4 ring-blue-100"
                    : isDone
                      ? "bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
                      : "bg-slate-100 text-slate-400 border border-slate-200"
                } ${!reachable ? "cursor-not-allowed" : ""}`}
                aria-label={`Go to step ${s.num}`}
              >
                {isDone ? <Check className="h-4 w-4" /> : s.num}
              </button>
              {i < RESIDENT_STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 rounded ${s.num < step ? "bg-blue-700" : "bg-slate-200"}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
