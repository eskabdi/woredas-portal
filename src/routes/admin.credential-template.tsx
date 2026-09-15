import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CreditCard,
  Upload,
  Loader2,
  CheckCircle2,
  Save,
  Send,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo2,
  Redo2,
  RotateCcw,
  Trash2,
  Plus,
  Lock,
} from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toWebp, storageExtension, TEMPLATE_WEBP } from "@/utils/imageCompression";
import { useAuthStore } from "@/stores/authStore";
import { CP } from "@/config/permissions";

export const Route = createFileRoute("/admin/credential-template")({
  ssr: false,
  component: CredentialTemplatePage,
});

type Side = "card_front" | "card_back";

interface TemplateRow {
  template_type: Side;
  background_image_url: string | null;
  is_published: boolean;
  updated_at: string;
}

interface FieldRow {
  template_field_id: string;
  template_type: string;
  field_key: string;
  field_type: "text" | "image" | string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number | null;
  font_weight: string | null;
  font_style: string | null;
  text_decoration: string | null;
  color: string | null;
  font_family: string | null;
  text_align: string;
  z_index: number;
  canvas_width: number;
  canvas_height: number;
}

const FIELD_LABELS: Record<string, string> = {
  full_name_am: "Full Name (AM)",
  full_name_en: "Full Name (EN)",
  gender: "Gender",
  dob_ethiopian: "DOB (Ethiopian)",
  dob_gregorian: "DOB (Gregorian)",
  photo: "Photo",
  watermark_photo: "Watermark",
  stamp: "Stamp",
  woreda_name: "Woreda (Amharic)",
  woreda_name_en: "Woreda (English)",
  woreda_name_har: "Woreda (Harari)",
  woreda_name_om: "Woreda (Oromiffa)",
  woreda_name_short: "Woreda Short Name (AM)",
  woreda_name_short_en: "Woreda Short Name (EN)",
  kebele_name: "Kebele",
  house_number: "House #",
  phone_number: "Phone",
  serial_number: "Serial #",
  barcode: "Barcode",
  qr_code: "QR Code",
  signature: "Signature",
  id_number: "ID Number",
  issue_date: "Issue Date",
  expiry_date: "Expiry Date",
  place_of_issue: "Place of Issue",
};

const FONT_FAMILIES = [
  "Inter",
  "Noto Sans Ethiopic",
  "Noto Serif Ethiopic",
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Courier New",
];

const MIN_W = 20;
const MIN_H = 10;

/** Physical width of a CR80 card -- mirrors CARD_WIDTH_MM in the print route
 * (woreda.credentials.$requestId.print.tsx), used here only to size a
 * freshly-inserted field in real millimetres rather than arbitrary canvas
 * units. */
const CARD_WIDTH_MM = 85.6;
/** Mirrors QR_PRINT_MM in the print route: below this, modules are finer
 * than a 300dpi card printer resolves and the code won't scan. */
const QR_MIN_PRINT_MM = 24;

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

// A QR code is a square grid of modules — stretching its bounding box would
// stretch the modules themselves, which is exactly the kind of distortion
// that makes a QR unscannable regardless of how large it prints. Locking the
// resize handles to 1:1 for this field is a print-correctness constraint, not
// a UI nicety.
const ASPECT_LOCKED_FIELD_KEYS = new Set(["qr_code"]);

// A handful of reference entities render as an <img>, not text -- confirmed
// against the current seed data (supabase/seed.sql) rather than assumed:
// barcode is field_type 'text' despite being special-rendered, so "special"
// doesn't mean "image".
const IMAGE_FIELD_KEYS = new Set(["photo", "watermark_photo", "signature", "qr_code", "stamp"]);

// id_card_template_field_draft is a wholly new table, absent from the
// generated types entirely -- cast the client for these calls rather than
// each query result, same pattern used for console_role/console_role_permission
// in admin.console-roles.tsx and useAuthBootstrap.ts. Regenerate types.ts
// post-deploy and drop this.
//
// db and rpc are cast VIEWS of the same `supabase` object, not extracted
// method references -- `db.rpc(...)`/`db.from(...)` still call with `this`
// bound to the real client. Pulling `.rpc` off into its own const (the
// previous shape here) strips that binding: SupabaseClient#rpc's body reads
// `this.rest.rpc(...)`, so an unbound call throws "Cannot read properties of
// undefined (reading 'rest')" synchronously, before any request is sent.
// flushDrafts() (a `db.from(...).update(...)` call, still correctly bound)
// would succeed and save the edit to the draft table, then publish/discard
// would throw immediately after -- draft edits never reach the live table,
// is_published never flips, and the print route (which only ever reads the
// live table) shows nothing new. That silent-looking failure is exactly
// what this cast shape now prevents.
const db = supabase as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
  rpc: (fn: string) => Promise<{ error: { message: string } | null }>;
};
const rpc = (fn: string) => db.rpc(fn);

function CredentialTemplatePage() {
  // isSuper doubles as this page's console-permission gate: role===super_admin
  // is necessary but not sufficient once a super_admin is scoped to a
  // console_role that lacks console.credential_template.manage.
  const hasConsolePerm = useAuthStore((s) => s.hasConsolePermission);
  const isSuper =
    useAuthStore((s) => s.role === "super_admin") && hasConsolePerm(CP.CREDENTIAL_TEMPLATE_MANAGE);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const qc = useQueryClient();

  const [activeSide, setActiveSide] = useState<Side>("card_front");
  const [drafts, setDrafts] = useState<Record<string, Partial<FieldRow>>>({});
  const [past, setPast] = useState<Record<string, Partial<FieldRow>>[]>([]);
  const [future, setFuture] = useState<Record<string, Partial<FieldRow>>[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const HISTORY_LIMIT = 50;
  const pushHistory = useCallback((snapshot: Record<string, Partial<FieldRow>>) => {
    setPast((p) => {
      const next = [...p, snapshot];
      return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
    });
    setFuture([]);
  }, []);

  const templatesQuery = useQuery({
    queryKey: ["id-card-templates"],
    queryFn: async () => {
      // is_published isn't in the generated types yet -- it regenerates only
      // once 00000000000010_id_card_template_draft.sql is applied to the live
      // project (see CLAUDE.md: "regenerate rather than edit"). The column
      // exists in the migration; this cast is the deliberate, temporary
      // escape hatch until deploy + regeneration.
      const { data, error } = await supabase
        .from("id_card_template")
        .select("template_type, background_image_url, is_published, updated_at");
      if (error) throw error;
      return (data ?? []) as unknown as TemplateRow[];
    },
  });

  // Reads the DRAFT table, not the live one -- this is the whole point of
  // the staging design (00000000000010_id_card_template_draft.sql): edits
  // made here have zero effect on printed cards until publish_id_card_
  // template() reconciles them into id_card_template_field. The print route
  // (woreda.credentials.$requestId.print.tsx) keeps reading the live table
  // directly and needs no changes.
  const fieldsQuery = useQuery({
    queryKey: ["id-card-template-field-drafts"],
    queryFn: async () => {
      const { data, error } = await db
        .from("id_card_template_field_draft")
        .select(
          "template_field_id, template_type, field_key, field_type, x, y, width, height, font_size, font_weight, font_style, text_decoration, color, font_family, text_align, z_index, canvas_width, canvas_height",
        )
        .order("field_key");
      if (error) throw error;
      return (data ?? []) as FieldRow[];
    },
  });

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const front = templates.find((t) => t.template_type === "card_front");
  const back = templates.find((t) => t.template_type === "card_back");

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

  // Signed URLs for private-bucket preview
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next: Record<string, string | null> = {};
      for (const t of templates) {
        if (t.background_image_url) {
          const { data } = await supabase.storage
            .from("credential-templates")
            .createSignedUrl(t.background_image_url, 900);
          next[t.template_type] = data?.signedUrl ?? null;
        } else {
          next[t.template_type] = null;
        }
      }
      if (!cancelled) setUrls(next);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [templates]);

  const merged = useCallback(
    (f: FieldRow): FieldRow => ({ ...f, ...(drafts[f.template_field_id] ?? {}) }),
    [drafts],
  );

  const sideFields = useMemo(
    () => fields.filter((f) => f.template_type === activeSide).map(merged),
    [fields, activeSide, merged],
  );

  const selected = useMemo(
    () => sideFields.find((f) => f.template_field_id === selectedId) ?? null,
    [sideFields, selectedId],
  );

  const patchField = useCallback(
    (id: string, patch: Partial<FieldRow>, options?: { history?: boolean }) => {
      const recordHistory = options?.history !== false;
      setDrafts((d) => {
        if (recordHistory) {
          pushHistory(d);
        }
        return { ...d, [id]: { ...d[id], ...patch } };
      });
    },
    [pushHistory],
  );

  const beginGesture = useCallback(() => {
    setDrafts((d) => {
      pushHistory(d);
      return d;
    });
  }, [pushHistory]);

  // Insert/delete are structural changes to the draft table itself, applied
  // immediately -- not part of the in-memory drafts/undo-redo system, which
  // only tracks property patches on existing rows.
  const insertField = useCallback(
    async (fieldKey: string, dropCenter?: { x: number; y: number }) => {
      if (!isSuper) return;
      const existingOnSide = fields.filter((f) => f.template_type === activeSide);
      if (existingOnSide.some((f) => f.field_key === fieldKey)) return;
      const canvasWidth = existingOnSide[0]?.canvas_width ?? 1688;
      const canvasHeight = existingOnSide[0]?.canvas_height ?? 1063;
      const isImage = IMAGE_FIELD_KEYS.has(fieldKey);

      // Per-key default sizes rather than one generic box: a QR or barcode
      // inserted at an arbitrary size can silently cross this app's own
      // print-safety floors (a QR that looks fine on screen but is too fine
      // for a 300dpi printer to resolve, or a barcode narrow enough that
      // CredentialBarcode's MIN_X_DIMENSION_UM guard refuses to render it),
      // and the other image fields look visibly wrong cropped into a
      // flat text-shaped box. Ratios for photo/watermark_photo/signature
      // mirror their seeded proportions (supabase/seed.sql) at the
      // reference 1688x1063 canvas, scaled to whatever this template's
      // actual canvas size is.
      let width: number;
      let height: number;
      if (fieldKey === "qr_code") {
        // PrintableCard renders the QR at 90% of the smaller field
        // dimension, so the field itself must clear QR_MIN_PRINT_MM / 0.9
        // (plus a small margin) to keep the printed QR at or above the same
        // floor the print route documents for the untemplated fallback card.
        const mmPerUnit = CARD_WIDTH_MM / canvasWidth;
        const sizeUnits = Math.ceil((QR_MIN_PRINT_MM / 0.9 / mmPerUnit) * 1.1);
        width = sizeUnits;
        height = sizeUnits;
      } else if (fieldKey === "barcode") {
        // Matches the seeded barcode field's real width (~48mm) -- narrower
        // than that and CredentialBarcode's density guard throws for a
        // 13-digit Code 128 code instead of rendering.
        width = Math.round(canvasWidth * (950 / 1688));
        height = Math.round(canvasHeight * (154 / 1063));
      } else if (fieldKey === "photo") {
        width = Math.round(canvasWidth * (430 / 1688));
        height = Math.round(canvasHeight * (530 / 1063));
      } else if (fieldKey === "signature") {
        width = Math.round(canvasWidth * (392 / 1688));
        height = Math.round(canvasHeight * (177 / 1063));
      } else if (fieldKey === "watermark_photo") {
        width = Math.round(canvasWidth * (151 / 1688));
        height = Math.round(canvasHeight * (149 / 1063));
      } else if (fieldKey === "stamp") {
        width = Math.round(canvasWidth * (350 / 1688));
        height = Math.round(canvasHeight * (300 / 1063));
      } else {
        width = Math.round(canvasWidth * 0.25);
        height = Math.round(canvasHeight * 0.1);
      }
      const maxZ = existingOnSide.reduce((m, f) => Math.max(m, f.z_index ?? 0), 0);
      const centerX = dropCenter?.x ?? canvasWidth / 2;
      const centerY = dropCenter?.y ?? canvasHeight / 2;
      const x = Math.round(Math.max(0, Math.min(canvasWidth - width, centerX - width / 2)));
      const y = Math.round(Math.max(0, Math.min(canvasHeight - height, centerY - height / 2)));
      const { data, error } = await db
        .from("id_card_template_field_draft")
        .insert({
          template_type: activeSide,
          field_key: fieldKey,
          x,
          y,
          width,
          height,
          font_size: isImage ? null : 20,
          font_weight: isImage ? null : "normal",
          text_align: "left",
          z_index: maxZ + 1,
          canvas_width: canvasWidth,
          canvas_height: canvasHeight,
          field_type: isImage ? "image" : "text",
          color: "#000000",
          font_family: "Inter",
          font_style: "normal",
          text_decoration: "none",
        })
        .select("template_field_id")
        .single();
      if (error) {
        toast.error(error.message);
        return;
      }
      await supabase.from("audit_log").insert({
        actor_user_id: actorUserId,
        entity_name: "id_card_template_field_draft",
        entity_id: data.template_field_id,
        action_type: "TEMPLATE_FIELD_ADDED",
        new_value_json: { template_type: activeSide, field_key: fieldKey },
      });
      qc.invalidateQueries({ queryKey: ["id-card-template-field-drafts"] });
      setSelectedId(data.template_field_id);
    },
    [isSuper, fields, activeSide, qc, actorUserId],
  );

  const deleteField = useCallback(async () => {
    if (!isSuper || !selectedId) return;
    const removed = fields.find((f) => f.template_field_id === selectedId);
    const { error } = await db
      .from("id_card_template_field_draft")
      .delete()
      .eq("template_field_id", selectedId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("audit_log").insert({
      actor_user_id: actorUserId,
      entity_name: "id_card_template_field_draft",
      entity_id: selectedId,
      action_type: "TEMPLATE_FIELD_REMOVED",
      old_value_json: removed
        ? { template_type: removed.template_type, field_key: removed.field_key }
        : null,
    });
    setSelectedId(null);
    qc.invalidateQueries({ queryKey: ["id-card-template-field-drafts"] });
  }, [isSuper, selectedId, fields, qc, actorUserId]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setDrafts((current) => {
        setFuture((f) => [...f, current]);
        return prev;
      });
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setDrafts((current) => {
        setPast((p) => [...p, current]);
        return next;
      });
      return f.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteField();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteField, selectedId]);

  const handleUpload = async (side: Side, file: File) => {
    if (!isSuper) return;
    // Card artwork is printed at card size, so this is the least aggressive
    // of the three presets — the conversion is for bandwidth, not for bytes.
    const upload = await toWebp(file, TEMPLATE_WEBP);
    const path = `${side}.${storageExtension(upload, "png")}`;
    const { error: upErr } = await supabase.storage
      .from("credential-templates")
      .upload(path, upload, { upsert: true, contentType: upload.type });
    if (upErr) {
      toast.error(`Upload failed: ${upErr.message}`);
      return;
    }
    // is_published: see the matching comment on templatesQuery above -- same
    // deliberate, temporary cast until types regenerate post-deploy.
    const { error: dbErr } = await supabase
      .from("id_card_template")
      .update({
        background_image_url: path,
        is_published: false,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("template_type", side);
    if (dbErr) {
      toast.error(`Save failed: ${dbErr.message}`);
      return;
    }
    toast.success("Background uploaded (draft)");
    qc.invalidateQueries({ queryKey: ["id-card-templates"] });
  };

  // Flushes in-memory patches to the draft table -- shared by saveDraft()
  // and publish() (publish must flush first, otherwise a field moved but
  // never explicitly saved would publish its old position).
  const flushDrafts = async () => {
    for (const [id, patch] of Object.entries(drafts)) {
      const { error } = await db
        .from("id_card_template_field_draft")
        .update({
          x: patch.x,
          y: patch.y,
          width: patch.width,
          height: patch.height,
          font_size: patch.font_size,
          font_weight: patch.font_weight ?? undefined,
          font_style: patch.font_style ?? undefined,
          text_decoration: patch.text_decoration ?? undefined,
          color: patch.color ?? undefined,
          font_family: patch.font_family ?? undefined,
          text_align: patch.text_align,
        })
        .eq("template_field_id", id);
      if (error) throw error;
    }
  };

  const saveDraft = async () => {
    if (!isSuper) return;
    const changedIds = Object.keys(drafts);
    if (changedIds.length === 0) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    try {
      await flushDrafts();
      await supabase.from("audit_log").insert({
        actor_user_id: actorUserId,
        entity_name: "id_card_template_field_draft",
        action_type: "TEMPLATE_DRAFT_SAVED",
        new_value_json: { template_type: activeSide, field_count: changedIds.length },
      });
      toast.success("Draft saved");
      setDrafts({});
      setPast([]);
      setFuture([]);
      qc.invalidateQueries({ queryKey: ["id-card-template-field-drafts"] });
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!isSuper) return;
    setPublishing(true);
    try {
      await flushDrafts();
      // Reconciles the draft table into the live one (upsert changed/new
      // fields, delete any live field the draft no longer has) in one
      // transaction, then flips id_card_template.is_published = true.
      const { error } = await rpc("publish_id_card_template");
      if (error) throw error;
      toast.success("Template published");
      setDrafts({});
      setPast([]);
      setFuture([]);
      qc.invalidateQueries({ queryKey: ["id-card-templates"] });
      qc.invalidateQueries({ queryKey: ["id-card-template-field-drafts"] });
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message}`);
    } finally {
      setPublishing(false);
    }
  };

  const discardDraft = async () => {
    if (!isSuper) return;
    setDiscarding(true);
    try {
      const { error } = await rpc("discard_id_card_template_draft");
      if (error) throw error;
      toast.success("Draft discarded");
      setDrafts({});
      setPast([]);
      setFuture([]);
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["id-card-templates"] });
      qc.invalidateQueries({ queryKey: ["id-card-template-field-drafts"] });
    } catch (e) {
      toast.error(`Discard failed: ${(e as Error).message}`);
    } finally {
      setDiscarding(false);
    }
  };

  if (!isSuper) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        You do not have permission to manage the ID card template.
      </div>
    );
  }

  const currentTemplate = activeSide === "card_front" ? front : back;
  const currentUrl = urls[activeSide] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        variant="plain"
        icon={CreditCard}
        titleAm="የመታወቂያ ቅጽ ማስተዳደሪያ"
        titleEn="ID Card Template Management"
        actions={
          <>
            <Button
              variant="outline"
              onClick={undo}
              disabled={past.length === 0}
              title="Undo (Ctrl/Cmd+Z)"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Undo
            </Button>
            <Button
              variant="outline"
              onClick={redo}
              disabled={future.length === 0}
              title="Redo (Ctrl/Cmd+Shift+Z)"
            >
              <Redo2 className="mr-2 h-4 w-4" />
              Redo
            </Button>
            <Button variant="outline" onClick={saveDraft} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Draft
            </Button>
            <Button
              variant="outline"
              onClick={discardDraft}
              disabled={discarding}
              title="Reset the draft back to the last published state"
            >
              {discarding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Discard Draft
            </Button>
            <Button
              className="bg-blue-700 hover:bg-blue-800"
              onClick={publish}
              disabled={publishing}
            >
              {publishing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Publish Template
            </Button>
          </>
        }
      />

      {/* Side toggle + upload row */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Editing:</span>
          <div className="flex gap-1 rounded-md bg-slate-100 p-1">
            {(["card_front", "card_back"] as Side[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setActiveSide(s);
                  setSelectedId(null);
                }}
                className={`rounded px-4 py-1.5 text-sm font-medium transition ${
                  activeSide === s
                    ? "bg-blue-700 text-white shadow"
                    : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                {s === "card_front" ? "Front / ፊት" : "Back / ጀርባ"}
              </button>
            ))}
          </div>
          {currentTemplate?.is_published ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-medium text-white">
              <CheckCircle2 className="h-3 w-3" /> Active
            </span>
          ) : (
            <span className="rounded-full bg-slate-500 px-2.5 py-0.5 text-xs font-medium text-white">
              Draft
            </span>
          )}
        </div>
        <BackgroundUploader
          side={activeSide}
          template={currentTemplate}
          onUpload={(f) => handleUpload(activeSide, f)}
        />
      </div>

      {/* Canvas + Properties */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <EditorCanvas
          fields={sideFields}
          backgroundUrl={currentUrl}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onPatch={patchField}
          onBeginGesture={beginGesture}
          onDropInsert={(fieldKey, x, y) => insertField(fieldKey, { x, y })}
        />
        <PropertiesPanel field={selected} onPatch={patchField} onDelete={deleteField} />
      </div>

      {Object.keys(drafts).length > 0 && (
        <p className="text-xs text-amber-700">
          You have {Object.keys(drafts).length} unsaved change(s). Click “Save Draft” to persist or
          “Publish Template” to activate.
        </p>
      )}

      <ReferenceEntityPalette activeSide={activeSide} fields={fields} onInsert={insertField} />
    </div>
  );
}

function BackgroundUploader({
  side,
  template,
  onUpload,
}: {
  side: Side;
  template: TemplateRow | undefined;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      {template?.background_image_url && (
        <span className="max-w-[240px] truncate text-xs text-slate-500">
          {template.background_image_url}
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        title={`Upload ${side === "card_front" ? "front" : "back"} background`}
      >
        <Upload className="mr-2 h-4 w-4" />
        Upload Background
      </Button>
    </div>
  );
}

function EditorCanvas({
  fields,
  backgroundUrl,
  selectedId,
  onSelect,
  onPatch,
  onBeginGesture,
  onDropInsert,
}: {
  fields: FieldRow[];
  backgroundUrl: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<FieldRow>, options?: { history?: boolean }) => void;
  onBeginGesture: () => void;
  onDropInsert: (fieldKey: string, x: number, y: number) => void;
}) {
  const canvasW = fields[0]?.canvas_width ?? 1688;
  const canvasH = fields[0]?.canvas_height ?? 1063;
  const wrapperRef = useRef<HTMLDivElement>(null);

  // pointer -> template unit conversion via measured DOM size
  const getScale = () => {
    const el = wrapperRef.current;
    if (!el) return { sx: 1, sy: 1 };
    const rect = el.getBoundingClientRect();
    return { sx: canvasW / rect.width, sy: canvasH / rect.height };
  };

  const startDrag = (e: React.PointerEvent, f: FieldRow) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.template_field_id);
    onBeginGesture();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const start = { px: e.clientX, py: e.clientY, x: f.x, y: f.y };
    const onMove = (ev: PointerEvent) => {
      const { sx, sy } = getScale();
      const dx = (ev.clientX - start.px) * sx;
      const dy = (ev.clientY - start.py) * sy;
      const nx = Math.max(0, Math.min(canvasW - f.width, start.x + dx));
      const ny = Math.max(0, Math.min(canvasH - f.height, start.y + dy));
      onPatch(f.template_field_id, { x: Math.round(nx), y: Math.round(ny) }, { history: false });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startResize = (e: React.PointerEvent, f: FieldRow, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.template_field_id);
    onBeginGesture();
    const start = {
      px: e.clientX,
      py: e.clientY,
      x: f.x,
      y: f.y,
      w: f.width,
      h: f.height,
    };
    const onMove = (ev: PointerEvent) => {
      const { sx, sy } = getScale();
      const dx = (ev.clientX - start.px) * sx;
      const dy = (ev.clientY - start.py) * sy;
      let { x, y, w, h: hh } = start;
      if (h.includes("e")) w = start.w + dx;
      if (h.includes("s")) hh = start.h + dy;
      if (h.includes("w")) {
        w = start.w - dx;
        x = start.x + dx;
      }
      if (h.includes("n")) {
        hh = start.h - dy;
        y = start.y + dy;
      }
      if (ASPECT_LOCKED_FIELD_KEYS.has(f.field_key)) {
        // Whichever axis the handle actually drives sets the square's side —
        // for a straight edge handle (e.g. "e") that's the one dimension the
        // user is dragging; for a corner, it's whichever moved further, so a
        // diagonal drag still feels proportionate rather than snapping to
        // whichever axis happens to be listed first.
        const drivesW = h.includes("e") || h.includes("w");
        const drivesH = h.includes("n") || h.includes("s");
        const size = drivesW && drivesH ? Math.max(w, hh) : drivesW ? w : hh;
        // The edge(s) NOT being dragged stay put; a pure edge handle (only one
        // axis named) grows/shrinks the other axis symmetrically about its
        // center, since nothing in a horizontal-only drag says which vertical
        // edge should move.
        const left = h.includes("w")
          ? start.x + start.w - size
          : h.includes("e")
            ? start.x
            : start.x + (start.w - size) / 2;
        const top = h.includes("n")
          ? start.y + start.h - size
          : h.includes("s")
            ? start.y
            : start.y + (start.h - size) / 2;
        x = left;
        y = top;
        w = size;
        hh = size;
      }
      // enforce mins
      if (w < MIN_W || hh < MIN_H) {
        const minSize = Math.max(MIN_W, MIN_H);
        if (ASPECT_LOCKED_FIELD_KEYS.has(f.field_key)) {
          if (h.includes("w")) x -= minSize - w;
          if (h.includes("n")) y -= minSize - hh;
          w = minSize;
          hh = minSize;
        } else {
          if (w < MIN_W) {
            if (h.includes("w")) x -= MIN_W - w;
            w = MIN_W;
          }
          if (hh < MIN_H) {
            if (h.includes("n")) y -= MIN_H - hh;
            hh = MIN_H;
          }
        }
      }
      // clamp to canvas
      if (x < 0) {
        if (ASPECT_LOCKED_FIELD_KEYS.has(f.field_key)) {
          w += x;
          hh = w;
        } else {
          w += x;
        }
        x = 0;
      }
      if (y < 0) {
        if (ASPECT_LOCKED_FIELD_KEYS.has(f.field_key)) {
          hh += y;
          w = hh;
        } else {
          hh += y;
        }
        y = 0;
      }
      if (x + w > canvasW) {
        w = canvasW - x;
        if (ASPECT_LOCKED_FIELD_KEYS.has(f.field_key)) hh = w;
      }
      if (y + hh > canvasH) {
        hh = canvasH - y;
        if (ASPECT_LOCKED_FIELD_KEYS.has(f.field_key)) w = hh;
      }
      onPatch(
        f.template_field_id,
        {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(hh),
        },
        { history: false },
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div
        ref={wrapperRef}
        onPointerDown={() => onSelect(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const fieldKey = e.dataTransfer.getData("text/plain");
          if (!fieldKey) return;
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (!rect) return;
          const { sx, sy } = getScale();
          const x = (e.clientX - rect.left) * sx;
          const y = (e.clientY - rect.top) * sy;
          onDropInsert(fieldKey, x, y);
        }}
        className="relative w-full select-none overflow-hidden rounded-md border border-slate-300 bg-slate-100"
        style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
      >
        {backgroundUrl ? (
          <img
            src={backgroundUrl}
            alt="Template background"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            No background uploaded — fields render on empty canvas
          </div>
        )}

        {fields.map((f) => {
          const isSelected = f.template_field_id === selectedId;
          const isImage = f.field_type === "image";
          const label = FIELD_LABELS[f.field_key] ?? f.field_key;
          const align =
            f.text_align === "center"
              ? "center"
              : f.text_align === "right"
                ? "flex-end"
                : "flex-start";
          const textStyle: React.CSSProperties = isImage
            ? {}
            : {
                fontFamily: f.font_family ?? "Inter",
                fontWeight: f.font_weight === "bold" ? 700 : 400,
                fontStyle: f.font_style === "italic" ? "italic" : "normal",
                textDecoration: f.text_decoration ?? "none",
                color: f.color ?? "#000000",
                // Scale template font-size roughly to display; use % of canvas height
                fontSize: `${((f.font_size ?? 16) / f.canvas_height) * 100}cqh`,
                justifyContent: align,
              };
          return (
            <div
              key={f.template_field_id}
              onPointerDown={(e) => startDrag(e, f)}
              className={`group absolute flex items-center overflow-hidden border-2 ${
                isSelected
                  ? "border-blue-600 bg-blue-500/10"
                  : "border-dashed border-blue-400/70 bg-blue-400/10 hover:border-blue-500"
              } cursor-move`}
              style={{
                left: `${(f.x / f.canvas_width) * 100}%`,
                top: `${(f.y / f.canvas_height) * 100}%`,
                width: `${(f.width / f.canvas_width) * 100}%`,
                height: `${(f.height / f.canvas_height) * 100}%`,
                containerType: "size",
                zIndex: isSelected ? 20 : 10 + (f.z_index ?? 0),
                ...textStyle,
              }}
              title={label}
            >
              <span
                className={`pointer-events-none w-full truncate px-1 ${
                  isImage ? "text-center text-[11px] font-medium text-blue-800" : ""
                }`}
              >
                {isImage ? `🖼 ${label}` : label}
              </span>

              {isSelected &&
                (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map((h) => (
                  <ResizeHandle key={h} handle={h} onPointerDown={(e) => startResize(e, f, h)} />
                ))}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Click to select • Drag to move • Drag handles to resize • Click empty canvas to deselect
      </p>
    </div>
  );
}

function ResizeHandle({
  handle,
  onPointerDown,
}: {
  handle: Handle;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const pos: Record<Handle, React.CSSProperties> = {
    nw: { left: -5, top: -5, cursor: "nwse-resize" },
    n: { left: "50%", top: -5, transform: "translateX(-50%)", cursor: "ns-resize" },
    ne: { right: -5, top: -5, cursor: "nesw-resize" },
    e: { right: -5, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
    se: { right: -5, bottom: -5, cursor: "nwse-resize" },
    s: { left: "50%", bottom: -5, transform: "translateX(-50%)", cursor: "ns-resize" },
    sw: { left: -5, bottom: -5, cursor: "nesw-resize" },
    w: { left: -5, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
  };
  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute z-30 h-2.5 w-2.5 rounded-sm border border-white bg-blue-600 shadow"
      style={pos[handle]}
    />
  );
}

function PropertiesPanel({
  field,
  onPatch,
  onDelete,
}: {
  field: FieldRow | null;
  onPatch: (id: string, patch: Partial<FieldRow>) => void;
  onDelete: () => void;
}) {
  if (!field) {
    return (
      <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700">Properties</h3>
        <p className="mt-3 text-sm text-slate-500">
          Select an element on the canvas to edit its properties.
        </p>
      </aside>
    );
  }

  const isImage = field.field_type === "image";
  const label = FIELD_LABELS[field.field_key] ?? field.field_key;
  const aspectLocked = ASPECT_LOCKED_FIELD_KEYS.has(field.field_key);
  const patch = (p: Partial<FieldRow>) => onPatch(field.template_field_id, p);

  return (
    <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Properties</h3>
          <p className="mt-1 text-sm font-medium text-blue-700">{label}</p>
          <p className="font-mono text-[10px] text-slate-400">{field.field_key}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          title="Delete field (Delete/Backspace)"
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {!isImage && (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Font Family</Label>
            <Select
              value={field.font_family ?? "Inter"}
              onValueChange={(v) => patch({ font_family: v })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldNum
              label="Font Size"
              value={field.font_size ?? 0}
              onChange={(v) => patch({ font_size: v })}
            />
            <div className="space-y-2">
              <Label className="text-xs">Color</Label>
              <Input
                type="color"
                value={field.color ?? "#000000"}
                onChange={(e) => patch({ color: e.target.value })}
                className="h-8 w-full p-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Style</Label>
            <div className="mt-1 flex gap-1">
              <ToggleBtn
                active={field.font_weight === "bold"}
                onClick={() =>
                  patch({ font_weight: field.font_weight === "bold" ? "normal" : "bold" })
                }
                title="Bold"
              >
                <Bold className="h-4 w-4" />
              </ToggleBtn>
              <ToggleBtn
                active={field.font_style === "italic"}
                onClick={() =>
                  patch({ font_style: field.font_style === "italic" ? "normal" : "italic" })
                }
                title="Italic"
              >
                <Italic className="h-4 w-4" />
              </ToggleBtn>
              <ToggleBtn
                active={field.text_decoration === "underline"}
                onClick={() =>
                  patch({
                    text_decoration: field.text_decoration === "underline" ? "none" : "underline",
                  })
                }
                title="Underline"
              >
                <Underline className="h-4 w-4" />
              </ToggleBtn>
              <div className="mx-1 w-px bg-slate-200" />
              <ToggleBtn
                active={field.text_align === "left"}
                onClick={() => patch({ text_align: "left" })}
                title="Align left"
              >
                <AlignLeft className="h-4 w-4" />
              </ToggleBtn>
              <ToggleBtn
                active={field.text_align === "center"}
                onClick={() => patch({ text_align: "center" })}
                title="Align center"
              >
                <AlignCenter className="h-4 w-4" />
              </ToggleBtn>
              <ToggleBtn
                active={field.text_align === "right"}
                onClick={() => patch({ text_align: "right" })}
                title="Align right"
              >
                <AlignRight className="h-4 w-4" />
              </ToggleBtn>
            </div>
          </div>
        </>
      )}

      <div>
        <Label className="text-xs uppercase tracking-wide text-slate-500">Position & Size</Label>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <FieldNum label="X" value={field.x} onChange={(v) => patch({ x: v })} />
          <FieldNum label="Y" value={field.y} onChange={(v) => patch({ y: v })} />
          <FieldNum
            label={aspectLocked ? "Width (= height)" : "Width"}
            value={field.width}
            onChange={(v) => {
              const w = Math.max(MIN_W, v);
              patch(aspectLocked ? { width: w, height: w } : { width: w });
            }}
          />
          <FieldNum
            label={aspectLocked ? "Height (= width)" : "Height"}
            value={field.height}
            onChange={(v) => {
              const hh = Math.max(MIN_H, v);
              patch(aspectLocked ? { width: hh, height: hh } : { height: hh });
            }}
          />
        </div>
        {aspectLocked && (
          <p className="mt-2 text-xs text-slate-500">
            Locked to a square — a stretched QR code does not scan.
          </p>
        )}
      </div>
    </aside>
  );
}

function FieldNum({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8"
      />
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded border transition ${
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function ReferenceEntityPalette({
  activeSide,
  fields,
  onInsert,
}: {
  activeSide: Side;
  fields: FieldRow[];
  onInsert: (fieldKey: string) => void;
}) {
  const usedOnSide = new Set(
    fields.filter((f) => f.template_type === activeSide).map((f) => f.field_key),
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">Reference Entities</h3>
      <p className="mt-1 text-xs text-slate-500">
        Click or drag onto the canvas to place. An entity already on this side is locked — delete it
        from the canvas (or its Properties panel) to place it again.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.keys(FIELD_LABELS).map((key) => {
          const inUse = usedOnSide.has(key);
          return (
            <button
              key={key}
              type="button"
              disabled={inUse}
              draggable={!inUse}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", key)}
              onClick={() => !inUse && onInsert(key)}
              title={
                inUse ? `${FIELD_LABELS[key]} is already on this side` : `Add ${FIELD_LABELS[key]}`
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                inUse
                  ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                  : "cursor-grab border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 active:cursor-grabbing"
              }`}
            >
              {inUse ? <Lock className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              {FIELD_LABELS[key]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
