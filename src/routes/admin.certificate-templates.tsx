import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Bold,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileDown,
  FileText,
  GripVertical,
  Italic,
  Loader2,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Send,
  StretchHorizontal,
  StretchVertical,
  Trash2,
  Type,
  Undo2,
  Upload,
} from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import {
  ConsolePermissionGate,
  InsufficientConsolePermissionNotice,
} from "@/components/common/ConsolePermissionGate";
import { CertificatePage } from "@/components/certificates/CertificatePage";
import {
  PAGE_MM,
  STATIC_FIELD_KEY,
  CERTIFICATE_ORIENTATION,
  formatForLanguage,
  formatLanguage,
  placeholderLabel,
  type Orientation,
  type PlacedField,
  type PlacementLanguage,
} from "@/components/certificates/certificateLayout";
import {
  alignBoxes,
  boxesInRect,
  distributeBoxes,
  matchSize,
  moveBoxes,
  type AlignMode,
  type Axis,
  type Box,
  type BoxPatch,
} from "@/lib/certificateAlign";
import { captureCertificatePdf, toDataUrl } from "@/lib/certificatePdf";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CERTIFICATE_FIELDS,
  CERTIFICATE_TYPES,
  CERTIFICATE_TYPE_LABELS,
  FIELD_GROUPS,
  FORMAT_LABELS,
  type CertificateField,
  type FieldGroup,
  certificateField,
  defaultFormat,
  formatsFor,
  type CertificateType,
  type FieldFormat,
  type ResolvedValue,
} from "@/config/certificateFields";
import { CP } from "@/config/permissions";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { storageExtension, toWebp, TEMPLATE_WEBP } from "@/utils/imageCompression";

export const Route = createFileRoute("/admin/certificate-templates")({
  ssr: false,
  component: () => (
    <ConsolePermissionGate
      permission={CP.CERTIFICATE_TEMPLATE_MANAGE}
      fallback={<InsufficientConsolePermissionNotice />}
    >
      <CertificateTemplatesPage />
    </ConsolePermissionGate>
  ),
});

// certificate_template* (migration 101) are not in the generated types yet;
// same cast-view pattern as admin.credential-template.tsx (a cast of the
// client object, never an extracted method, so `this` stays bound).
const db = supabase as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;
};

const BUCKET = "certificate-templates";
const FONT_FAMILIES = ["Tayitu", "Jiret", "Noto Sans Ethiopic", "Times New Roman", "Arial"];
const MIN_PCT = 1;
/** Default box for a new text placement (data or static), in percent of the page. */
const TEXT_DEFAULT_SIZE = { width: 8, height: 10 };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface TemplateRow {
  certificate_type: CertificateType;
  background_path: string | null;
  is_published: boolean;
  published_at: string | null;
}

const FIELD_COLUMNS =
  "certificate_field_id, certificate_type, field_key, format, binding_mode, static_value, x, y, width, height, font_size, font_weight, font_style, text_align, color, font_family, z_index";

/** Sample values for the preview toggle -- clearly marked as samples. */
function sampleValues(type: CertificateType): Record<string, ResolvedValue> {
  const out: Record<string, ResolvedValue> = {};
  for (const f of CERTIFICATE_FIELDS[type]) {
    if (f.kind === "date") out[f.key] = { date: "2025-01-20" };
    else if (f.kind === "sex") out[f.key] = { text: "female" };
    else if (f.kind === "text") out[f.key] = { text: "HR-AD-17-000123" };
    else if (f.kind === "bilingual") out[f.key] = { am: "ናሙና", en: "Sample" };
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function CertificateTemplatesPage() {
  const qc = useQueryClient();
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);

  const [type, setType] = useState<CertificateType>("birth");
  const [patches, setPatches] = useState<Record<string, Partial<PlacedField>>>({});
  const [past, setPast] = useState<Record<string, Partial<PlacedField>>[]>([]);
  const [future, setFuture] = useState<Record<string, Partial<PlacedField>>[]>([]);
  // Multi-selection: the last id is the primary field (the reference for
  // "match size" and the one the single-field properties panel edits).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  // PDF print preview: the draft rendered with sample values to an A4
  // landscape PDF, shown in the browser's PDF viewer. Watermarked.
  const pdfNodeRef = useRef<HTMLDivElement>(null);
  const [pdfBg, setPdfBg] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  const pdfSamples = useMemo(() => sampleValues(type), [type]);
  const [busy, setBusy] = useState<null | "save" | "publish" | "discard" | "upload">(null);

  const templatesQuery = useQuery({
    queryKey: ["certificate-templates"],
    queryFn: async () => {
      const { data, error } = await db
        .from("certificate_template")
        .select("certificate_type, background_path, is_published, published_at");
      if (error) throw error;
      return (data ?? []) as TemplateRow[];
    },
  });
  const template = templatesQuery.data?.find((t) => t.certificate_type === type) ?? null;
  // Certificates are A4 landscape only (migration 104 enforces it).
  const orientation: Orientation = CERTIFICATE_ORIENTATION;

  const fieldsQuery = useQuery({
    queryKey: ["certificate-template-drafts", type],
    queryFn: async () => {
      const { data, error } = await db
        .from("certificate_template_field_draft")
        .select(FIELD_COLUMNS)
        .eq("certificate_type", type)
        .order("z_index");
      if (error) throw error;
      return ((data ?? []) as PlacedField[]).map((f) => ({
        ...f,
        x: Number(f.x),
        y: Number(f.y),
        width: Number(f.width),
        height: Number(f.height),
        font_size: Number(f.font_size),
      }));
    },
  });

  // Switching certificate drops unsaved geometry edits for the old one.
  useEffect(() => {
    setPatches({});
    setPast([]);
    setFuture([]);
    setSelectedIds([]);
  }, [type]);

  const [bgUrl, setBgUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!template?.background_path) return setBgUrl(null);
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(template.background_path, 900);
      if (!cancelled) setBgUrl(data?.signedUrl ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [template?.background_path]);

  const fields = useMemo(
    () =>
      (fieldsQuery.data ?? []).map((f) => ({ ...f, ...(patches[f.certificate_field_id] ?? {}) })),
    [fieldsQuery.data, patches],
  );
  const selectedFields = useMemo(
    () => fields.filter((f) => selectedIds.includes(f.certificate_field_id)),
    [fields, selectedIds],
  );
  const primaryId = selectedIds[selectedIds.length - 1] ?? null;
  const selected =
    selectedIds.length === 1
      ? (fields.find((f) => f.certificate_field_id === primaryId) ?? null)
      : null;
  const dirty = Object.keys(patches).length > 0;

  const pushHistory = useCallback((snap: Record<string, Partial<PlacedField>>) => {
    setPast((p) => [...p.slice(-49), snap]);
    setFuture([]);
  }, []);

  const patchField = useCallback(
    (id: string, patch: Partial<PlacedField>, opts?: { history?: boolean }) => {
      setPatches((d) => {
        if (opts?.history !== false) pushHistory(d);
        return { ...d, [id]: { ...d[id], ...patch } };
      });
    },
    [pushHistory],
  );

  /** One history step for a change that touches several fields at once. */
  const patchMany = useCallback(
    (updates: Record<string, Partial<PlacedField>>, opts?: { history?: boolean }) => {
      if (!Object.keys(updates).length) return;
      setPatches((d) => {
        if (opts?.history !== false) pushHistory(d);
        const next = { ...d };
        for (const [id, p] of Object.entries(updates)) next[id] = { ...d[id], ...p };
        return next;
      });
    },
    [pushHistory],
  );

  const beginGesture = useCallback(() => {
    setPatches((d) => {
      pushHistory(d);
      return d;
    });
  }, [pushHistory]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setPatches((cur) => {
        setFuture((f) => [...f, cur]);
        return prev;
      });
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[f.length - 1];
      setPatches((cur) => {
        setPast((p) => [...p, cur]);
        return next;
      });
      return f.slice(0, -1);
    });
  }, []);

  const audit = (action: string, data: Record<string, unknown>) =>
    supabase.from("audit_log").insert({
      actor_user_id: actorUserId,
      entity_name: "certificate_template",
      entity_id: type,
      action_type: action,
      new_value_json: data as never,
    });

  // Structural changes (add / remove a placement) go straight to the draft
  // table; geometry and style edits are batched in `patches` until Save.
  const insertField = async (
    fieldKey: string,
    opts?: { format?: FieldFormat; at?: { x: number; y: number } },
  ) => {
    const isStatic = fieldKey === STATIC_FIELD_KEY;
    const def = isStatic ? null : certificateField(type, fieldKey);
    if (!isStatic && !def) return;
    const isImage = def?.kind === "image";
    const isQr = def?.kind === "qr";
    const format = isStatic
      ? "plain"
      : opts?.format && formatsFor(def!.kind).includes(opts.format)
        ? opts.format
        : defaultFormat(def!.kind);
    const page = PAGE_MM[orientation];
    // A QR is placed physically square (25 mm) -- percent units differ per axis.
    const width = isQr ? round2((25 / page.w) * 100) : isImage ? 18 : TEXT_DEFAULT_SIZE.width;
    const height = isQr ? round2((25 / page.h) * 100) : isImage ? 9 : TEXT_DEFAULT_SIZE.height;
    const at = opts?.at;
    const cx = at?.x ?? 50;
    const cy = at?.y ?? 50;
    const maxZ = fields.reduce((m, f) => Math.max(m, f.z_index), 0);
    const { data, error } = await db
      .from("certificate_template_field_draft")
      .insert({
        certificate_type: type,
        field_key: isStatic ? STATIC_FIELD_KEY : fieldKey,
        format,
        binding_mode: isStatic ? "static" : "data",
        static_value: isStatic ? "ጽሑፍ / Text" : null,
        x: round2(Math.max(0, Math.min(100 - width, cx - width / 2))),
        y: round2(Math.max(0, Math.min(100 - height, cy - height / 2))),
        width,
        height,
        font_size: 11,
        font_family: "Tayitu",
        z_index: Math.min(1000, maxZ + 1),
      })
      .select("certificate_field_id")
      .maybeSingle();
    if (error || !data) {
      toast.error(error?.message ?? "Could not add the field");
      return;
    }
    await audit("CERTIFICATE_TEMPLATE_FIELD_ADDED", { field_key: fieldKey, format });
    await qc.invalidateQueries({ queryKey: ["certificate-template-drafts", type] });
    qc.invalidateQueries({ queryKey: ["certificate-templates"] });
    setSelectedIds([data.certificate_field_id]);
  };

  const deleteSelected = useCallback(async () => {
    if (!selectedIds.length) return;
    const ids = [...selectedIds];
    const removed = fields.filter((f) => ids.includes(f.certificate_field_id));
    const { data, error } = await db
      .from("certificate_template_field_draft")
      .delete()
      .in("certificate_field_id", ids)
      .select("certificate_field_id");
    const gone = new Set(
      ((data ?? []) as { certificate_field_id: string }[]).map((r) => r.certificate_field_id),
    );
    if (error || !gone.size) {
      toast.error(error?.message ?? "Could not remove the field");
      return;
    }
    if (gone.size < ids.length) {
      toast.warning(`${gone.size} of ${ids.length} fields removed; reload to see the rest.`);
    }
    await audit("CERTIFICATE_TEMPLATE_FIELD_REMOVED", {
      field_keys: removed.filter((f) => gone.has(f.certificate_field_id)).map((f) => f.field_key),
    });
    setPatches((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !gone.has(id))));
    setSelectedIds([]);
    qc.invalidateQueries({ queryKey: ["certificate-template-drafts", type] });
    qc.invalidateQueries({ queryKey: ["certificate-templates"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, fields, type]);

  const nudge = useCallback(
    (dx: number, dy: number) => patchMany(moveBoxes(toBoxes(selectedFields), dx, dy)),
    [patchMany, selectedFields],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable ||
          t.closest("[role=dialog],[role=listbox],[role=menu]"))
      ) {
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length) {
        e.preventDefault();
        void deleteSelected();
        return;
      }
      if (e.key === "Escape" && selectedIds.length) {
        setSelectedIds([]);
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (arrows[e.key] && selectedIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1;
        nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "a") {
        e.preventDefault();
        setSelectedIds(fields.map((f) => f.certificate_field_id));
      } else if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, selectedIds, fields, nudge, undo, redo]);

  const flush = async () => {
    for (const [id, p] of Object.entries(patches)) {
      const { data, error } = await db
        .from("certificate_template_field_draft")
        .update({
          ...p,
          x: p.x === undefined ? undefined : round2(p.x),
          y: p.y === undefined ? undefined : round2(p.y),
          width: p.width === undefined ? undefined : round2(p.width),
          height: p.height === undefined ? undefined : round2(p.height),
          updated_at: new Date().toISOString(),
        })
        .eq("certificate_field_id", id)
        .select("certificate_field_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("A field was removed by someone else. Reload the page.");
    }
  };

  const resetHistory = () => {
    setPatches({});
    setPast([]);
    setFuture([]);
  };

  const save = async () => {
    if (!dirty) return toast.info("No changes to save");
    setBusy("save");
    try {
      await flush();
      await audit("CERTIFICATE_TEMPLATE_DRAFT_SAVED", { changed: Object.keys(patches).length });
      resetHistory();
      await qc.invalidateQueries({ queryKey: ["certificate-template-drafts", type] });
      qc.invalidateQueries({ queryKey: ["certificate-templates"] });
      toast.success("ረቂቁ ተቀምጧል / Draft saved");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy("publish");
    try {
      await flush();
      const { error } = await db.rpc("publish_certificate_template", { _type: type });
      if (error) throw new Error(error.message);
      resetHistory();
      await qc.invalidateQueries({ queryKey: ["certificate-template-drafts", type] });
      qc.invalidateQueries({ queryKey: ["certificate-templates"] });
      toast.success("አብነቱ ታትሟል / Template published");
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy("discard");
    try {
      const { error } = await db.rpc("discard_certificate_template_draft", { _type: type });
      if (error) throw new Error(error.message);
      resetHistory();
      setSelectedIds([]);
      await qc.invalidateQueries({ queryKey: ["certificate-template-drafts", type] });
      qc.invalidateQueries({ queryKey: ["certificate-templates"] });
      toast.success("Draft reverted to the published version");
    } catch (e) {
      toast.error(`Discard failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const updateTemplate = async (patch: Partial<TemplateRow>) => {
    const { data, error } = await db
      .from("certificate_template")
      .update({
        ...patch,
        is_published: false,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("certificate_type", type)
      .select("certificate_type")
      .maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "Template update did not apply");
    qc.invalidateQueries({ queryKey: ["certificate-templates"] });
  };

  const uploadBackground = async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      return toast.error("PNG, JPEG or WebP only");
    }
    if (file.size > 10 * 1024 * 1024) return toast.error("Maximum 10 MB");
    setBusy("upload");
    try {
      const upload = await toWebp(file, TEMPLATE_WEBP);
      const path = `${type}/background.${storageExtension(upload, "png")}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, upload, { upsert: true, contentType: upload.type });
      if (error) throw error;
      await updateTemplate({ background_path: path });
      await audit("CERTIFICATE_TEMPLATE_BACKGROUND_UPLOADED", { path });
      toast.success("Background uploaded (draft)");
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // "<key>" for any placement of a field, "<key>:am" / "<key>:en" per language.
  const placedKeys = new Set(
    fields.flatMap((f) => {
      const lang = formatLanguage(f.format);
      return lang ? [f.field_key, `${f.field_key}:${lang}`] : [f.field_key];
    }),
  );
  const openPdfPreview = async () => {
    setPdfBusy(true);
    try {
      setPdfBg(await toDataUrl(bgUrl));
      if (!pdfNodeRef.current) throw new Error("Preview surface unavailable");
      const blob = await captureCertificatePdf(pdfNodeRef.current, {
        title: `${CERTIFICATE_TYPE_LABELS[type].en} template`,
        preview: true,
      });
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e) {
      toast.error(`Could not build the PDF preview: ${(e as Error).message}`);
    } finally {
      setPdfBusy(false);
    }
  };

  const typeLabel = CERTIFICATE_TYPE_LABELS[type];

  return (
    <div className="space-y-4">
      <PageHeader
        variant="plain"
        icon={FileText}
        titleAm="የምስክር ወረቀት አብነቶች"
        titleEn="Certificate Templates"
        description="Design the civil-registration certificates: drag fields from the data model onto the page, choose language and date format, then publish."
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Certificate type">
        {CERTIFICATE_TYPES.map((t) => (
          <Button
            key={t}
            role="tab"
            aria-selected={t === type}
            variant={t === type ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (dirty && !window.confirm("Discard unsaved changes on this certificate?")) return;
              setType(t);
            }}
          >
            <span className="font-am-body">{CERTIFICATE_TYPE_LABELS[t].am}</span>
            <span className="ml-1 text-xs opacity-80">/ {CERTIFICATE_TYPE_LABELS[t].en}</span>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            template?.is_published && !dirty
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {template?.is_published && !dirty ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" /> Published
            </>
          ) : (
            "Unpublished changes"
          )}
        </span>
        <div className="mx-2 h-5 w-px bg-slate-200" />
        <span className="text-xs text-slate-600">A4 landscape</span>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
          {busy === "upload" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Background
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadBackground(file);
            }}
          />
        </label>
        <div className="mx-2 h-5 w-px bg-slate-200" />
        <Button
          variant="ghost"
          size="sm"
          onClick={undo}
          disabled={!past.length}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={redo}
          disabled={!future.length}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          variant={preview ? "default" : "outline"}
          size="sm"
          onClick={() => setPreview((p) => !p)}
          title="Show sample values instead of field names"
        >
          <Eye className="mr-1 h-4 w-4" /> Preview
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openPdfPreview()}
          disabled={pdfBusy || fieldsQuery.isLoading}
          title="Render the current draft, with sample values, as the A4 landscape PDF that prints"
        >
          {pdfBusy ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="mr-1 h-4 w-4" />
          )}
          PDF print preview
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={discard} disabled={busy !== null}>
            <RotateCcw className="mr-1 h-4 w-4" /> Discard draft
          </Button>
          <Button variant="outline" size="sm" onClick={save} disabled={busy !== null || !dirty}>
            {busy === "save" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save draft
          </Button>
          <Button size="sm" onClick={publish} disabled={busy !== null}>
            {busy === "publish" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            Publish
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_280px]">
        <FieldPalette
          type={type}
          placedKeys={placedKeys}
          onAdd={(k, format) => void insertField(k, { format })}
        />

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <p className="mb-2 text-xs text-slate-500">
            <span className="font-am-body">{typeLabel.am}</span> / {typeLabel.en} ·{" "}
            {PAGE_MM[orientation].w} × {PAGE_MM[orientation].h} mm
          </p>
          <EditorCanvas
            type={type}
            orientation={orientation}
            fields={fields}
            backgroundUrl={bgUrl}
            preview={preview}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            onPatch={patchField}
            onPatchMany={patchMany}
            onBeginGesture={beginGesture}
            onDropInsert={(k, format, x, y) => void insertField(k, { format, at: { x, y } })}
          />
          <p className="mt-2 text-[11px] text-slate-500">
            Shift- or Ctrl-click to select several fields, or drag a box around them on an empty
            part of the page. Ctrl+A selects all, arrow keys nudge (Shift for larger steps), Esc
            clears the selection.
          </p>
          {fieldsQuery.isLoading && <p className="mt-2 text-xs text-slate-500">Loading…</p>}
        </div>

        {selectedFields.length > 1 ? (
          <MultiSelectionPanel
            type={type}
            fields={selectedFields}
            primaryId={primaryId}
            onPatchMany={patchMany}
            onDelete={() => void deleteSelected()}
            onClear={() => setSelectedIds([])}
          />
        ) : (
          <PropertiesPanel
            type={type}
            orientation={orientation}
            field={selected}
            onPatch={(p) => selected && patchField(selected.certificate_field_id, p)}
            onPatchMany={patchMany}
            onDelete={() => void deleteSelected()}
          />
        )}
      </div>

      {/* Off-screen capture node for the PDF preview, at real A4 landscape size. */}
      <div aria-hidden className="pointer-events-none fixed top-0 -left-[10000px]">
        <div ref={pdfNodeRef} className="bg-white" style={{ width: `${PAGE_MM[orientation].w}mm` }}>
          <CertificatePage
            type={type}
            orientation={orientation}
            fields={fields}
            values={pdfSamples}
            backgroundUrl={pdfBg}
          />
        </div>
      </div>

      <Dialog open={!!pdfUrl} onOpenChange={(o) => !o && setPdfUrl(null)}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{typeLabel.en} — PDF print preview (A4 landscape)</DialogTitle>
            <DialogDescription>
              The current draft with sample values, exactly as the print route renders it. Stamped
              “PREVIEW - NOT VALID”; publish to make these placements live.
            </DialogDescription>
          </DialogHeader>
          {pdfUrl && (
            <iframe
              src={pdfUrl}
              title={`${typeLabel.en} PDF print preview`}
              className="block w-full rounded border"
              style={{ height: "75vh" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Drag payload: "<field key>" or "<field key>|<format>". */
const DRAG_SEP = "|";

function FieldPalette({
  type,
  placedKeys,
  onAdd,
}: {
  type: CertificateType;
  placedKeys: Set<string>;
  onAdd: (key: string, format?: FieldFormat) => void;
}) {
  const [q, setQ] = useState("");
  // Every group starts collapsed; a search opens the groups it matches in.
  const [open, setOpen] = useState<Set<FieldGroup>>(() => new Set());
  const all = CERTIFICATE_FIELDS[type];
  const needle = q.trim().toLowerCase();
  const match = (s: string) => s.toLowerCase().includes(needle);
  const toggle = (g: FieldGroup) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  return (
    <div className="max-h-[78vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-sm font-semibold text-slate-800">
        <span className="font-am-heading">የመረጃ መስኮች</span> / Data fields
      </p>
      <p className="mb-2 text-xs text-slate-500">
        Drag onto the page, or click to add. <b>አማ</b> places the Amharic value (Ethiopian date),{" "}
        <b>EN</b> the English one (Gregorian date).
      </p>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ፈልግ / Search"
        className="mb-3 h-8"
        aria-label="Search fields"
      />
      {FIELD_GROUPS.map((g) => {
        const items = all.filter(
          (f) => f.group === g.key && (!needle || match(f.am) || match(f.en)),
        );
        if (!items.length) return null;
        const isOpen = needle ? true : open.has(g.key);
        const placed = items.filter((f) => placedKeys.has(f.key)).length;
        const panelId = `cert-group-${g.key}`;
        return (
          <div key={g.key} className="mb-2 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => toggle(g.key)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 flex-none text-slate-500 transition-transform ${
                  isOpen ? "rotate-90" : ""
                }`}
              />
              <span className="min-w-0 flex-1 text-[11px] font-semibold text-slate-700">
                <span className="font-am-body">{g.am}</span> / {g.en}
              </span>
              <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">
                {placed}/{items.length}
              </span>
            </button>
            {isOpen && (
              <ul id={panelId} className="space-y-1 px-2 pb-2">
                {items.map((f) => (
                  <PaletteItem key={f.key} field={f} placedKeys={placedKeys} onAdd={onAdd} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <button
        type="button"
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", STATIC_FIELD_KEY)}
        onClick={() => onAdd(STATIC_FIELD_KEY)}
        className="mt-1 flex w-full items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-xs hover:border-blue-400 hover:bg-blue-50"
      >
        <Type className="h-3.5 w-3.5 text-slate-500" />
        <span className="font-am-body">ቋሚ ጽሑፍ</span> / Static text
        <Plus className="ml-auto h-3.5 w-3.5 text-slate-400" />
      </button>
    </div>
  );
}

function PaletteItem({
  field: f,
  placedKeys,
  onAdd,
}: {
  field: CertificateField;
  placedKeys: Set<string>;
  onAdd: (key: string, format?: FieldFormat) => void;
}) {
  const langs = (["am", "en"] as PlacementLanguage[])
    .map((lang) => ({ lang, format: formatForLanguage(f, lang) }))
    .filter((x): x is { lang: PlacementLanguage; format: FieldFormat } => x.format !== null);
  return (
    <li className="flex items-stretch gap-1">
      <button
        type="button"
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", f.key)}
        onClick={() => onAdd(f.key)}
        className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs hover:border-blue-400 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        title={`Add ${f.en}`}
      >
        <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
        <span className="min-w-0 flex-1">
          <span className="font-am-body block truncate text-slate-800">{f.am}</span>
          <span className="block truncate text-slate-500">{f.en}</span>
        </span>
        {!langs.length && placedKeys.has(f.key) && (
          <CheckCircle2
            className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-600"
            aria-label="placed"
          />
        )}
      </button>
      {langs.length > 0 && (
        <div className="flex flex-col gap-1">
          {langs.map(({ lang, format }) => {
            const placed = placedKeys.has(`${f.key}:${lang}`);
            const name = lang === "am" ? f.am : f.en;
            return (
              <button
                key={lang}
                type="button"
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData("text/plain", `${f.key}${DRAG_SEP}${format}`)
                }
                onClick={() => onAdd(f.key, format)}
                title={`Add "${name}" (${lang === "am" ? "Amharic" : "English"})`}
                aria-label={`Add ${f.en}, ${lang === "am" ? "Amharic" : "English"}`}
                className={`inline-flex min-w-[2.75rem] flex-1 items-center justify-center gap-0.5 rounded-md border px-1 text-[10px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  placed
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-600 hover:border-blue-400 hover:bg-blue-50"
                }`}
              >
                {placed && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                <span className={lang === "am" ? "font-am-body" : undefined}>
                  {lang === "am" ? "አማ" : "EN"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}

function EditorCanvas({
  type,
  orientation,
  fields,
  backgroundUrl,
  preview,
  selectedIds,
  onSelect,
  onPatch,
  onPatchMany,
  onBeginGesture,
  onDropInsert,
}: {
  type: CertificateType;
  orientation: Orientation;
  fields: PlacedField[];
  backgroundUrl: string | null;
  preview: boolean;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onPatch: (id: string, patch: Partial<PlacedField>, opts?: { history?: boolean }) => void;
  onPatchMany: (updates: Record<string, BoxPatch>, opts?: { history?: boolean }) => void;
  onBeginGesture: () => void;
  onDropInsert: (key: string, format: FieldFormat | undefined, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const samples = useMemo(() => sampleValues(type), [type]);
  const [marquee, setMarquee] = useState<Omit<Box, "id"> | null>(null);

  // pointer delta (px) -> percent of the page
  const toPct = (dxPx: number, dyPx: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return { dx: 0, dy: 0 };
    return { dx: (dxPx / r.width) * 100, dy: (dyPx / r.height) * 100 };
  };
  const pointPct = (clientX: number, clientY: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - r.top) / r.height) * 100)),
    };
  };

  const startDrag = (e: React.PointerEvent, f: PlacedField) => {
    e.stopPropagation();
    e.preventDefault();
    const id = f.certificate_field_id;
    // Shift / Ctrl / Cmd toggles the field in the selection; no drag.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      onSelect(
        selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
      );
      return;
    }
    const inSelection = selectedIds.includes(id);
    // Dragging a selected field moves the whole selection; it stays primary.
    const ids = inSelection ? [...selectedIds.filter((x) => x !== id), id] : [id];
    onSelect(ids);
    const start = fields
      .filter((x) => ids.includes(x.certificate_field_id))
      .map((x) => ({
        id: x.certificate_field_id,
        x: x.x,
        y: x.y,
        width: x.width,
        height: x.height,
      }));
    const origin = { px: e.clientX, py: e.clientY };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.abs(ev.clientX - origin.px) + Math.abs(ev.clientY - origin.py) < 3) return;
        moved = true;
        onBeginGesture();
      }
      const { dx, dy } = toPct(ev.clientX - origin.px, ev.clientY - origin.py);
      onPatchMany(moveBoxes(start, dx, dy), { history: false });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // A plain click on one field of a group narrows the selection to it.
      if (!moved && inSelection && ids.length > 1) onSelect([id]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Rubber-band selection from an empty part of the page.
  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? selectedIds : [];
    if (!additive) onSelect([]);
    const a = pointPct(e.clientX, e.clientY);
    let rect: Omit<Box, "id"> | null = null;
    const onMove = (ev: PointerEvent) => {
      const b = pointPct(ev.clientX, ev.clientY);
      rect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      };
      setMarquee(rect);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMarquee(null);
      if (!rect || rect.width + rect.height < 0.5) return;
      const hit = boxesInRect(
        fields.map((f) => ({
          id: f.certificate_field_id,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
        })),
        rect,
      );
      onSelect([...base, ...hit.filter((id) => !base.includes(id))]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startResize = (e: React.PointerEvent, f: PlacedField, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect([f.certificate_field_id]);
    onBeginGesture();
    const s = { px: e.clientX, py: e.clientY, x: f.x, y: f.y, w: f.width, h: f.height };
    const onMove = (ev: PointerEvent) => {
      const { dx, dy } = toPct(ev.clientX - s.px, ev.clientY - s.py);
      let { x, y, w, h: hh } = s;
      if (h.includes("e")) w = s.w + dx;
      if (h.includes("s")) hh = s.h + dy;
      if (h.includes("w")) {
        w = s.w - dx;
        x = s.x + dx;
      }
      if (h.includes("n")) {
        hh = s.h - dy;
        y = s.y + dy;
      }
      if (w < MIN_PCT) {
        if (h.includes("w")) x -= MIN_PCT - w;
        w = MIN_PCT;
      }
      if (hh < MIN_PCT) {
        if (h.includes("n")) y -= MIN_PCT - hh;
        hh = MIN_PCT;
      }
      if (x < 0) {
        w += x;
        x = 0;
      }
      if (y < 0) {
        hh += y;
        y = 0;
      }
      if (x + w > 100) w = 100 - x;
      if (y + hh > 100) hh = 100 - y;
      if (certificateField(type, f.field_key)?.kind === "qr") {
        // Keep the QR physically square: the side follows whichever axis the
        // handle drives, converted through the page's mm dimensions.
        const page = PAGE_MM[orientation];
        const sideMm = h === "n" || h === "s" ? (hh / 100) * page.h : (w / 100) * page.w;
        const side = Math.min(sideMm, ((100 - x) / 100) * page.w, ((100 - y) / 100) * page.h);
        w = (side / page.w) * 100;
        hh = (side / page.h) * 100;
      }
      onPatch(
        f.certificate_field_id,
        { x: round2(x), y: round2(y), width: round2(w), height: round2(hh) },
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

  const single = selectedIds.length === 1 ? selectedIds[0] : null;

  return (
    <div
      ref={ref}
      onPointerDown={startMarquee}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData("text/plain");
        const r = ref.current?.getBoundingClientRect();
        if (!raw || !r) return;
        const [key, format] = raw.split(DRAG_SEP);
        onDropInsert(
          key,
          (format as FieldFormat | undefined) || undefined,
          ((e.clientX - r.left) / r.width) * 100,
          ((e.clientY - r.top) / r.height) * 100,
        );
      }}
      className="relative mx-auto w-full max-w-[860px] select-none shadow-md ring-1 ring-slate-300"
    >
      <CertificatePage
        type={type}
        orientation={orientation}
        fields={fields}
        values={preview ? samples : null}
        backgroundUrl={backgroundUrl}
        renderOverlay={(f) => {
          const isSel = selectedIds.includes(f.certificate_field_id);
          const def = certificateField(type, f.field_key);
          return (
            <div
              onPointerDown={(e) => startDrag(e, f)}
              className={`absolute inset-0 cursor-move border ${
                isSel
                  ? "border-2 border-blue-600 bg-blue-500/10"
                  : "border-dashed border-blue-400/70 hover:border-blue-500"
              }`}
              title={def ? placeholderLabel(def, f.format) : "Static text"}
            >
              {single === f.certificate_field_id &&
                (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map((h) => (
                  <ResizeHandle key={h} handle={h} onPointerDown={(e) => startResize(e, f, h)} />
                ))}
            </div>
          );
        }}
      />
      {marquee && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[2000] border border-blue-600 bg-blue-500/10"
          style={{
            left: `${marquee.x}%`,
            top: `${marquee.y}%`,
            width: `${marquee.width}%`,
            height: `${marquee.height}%`,
          }}
        />
      )}
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
    nw: { left: -4, top: -4, cursor: "nwse-resize" },
    n: { left: "50%", top: -4, marginLeft: -4, cursor: "ns-resize" },
    ne: { right: -4, top: -4, cursor: "nesw-resize" },
    e: { right: -4, top: "50%", marginTop: -4, cursor: "ew-resize" },
    se: { right: -4, bottom: -4, cursor: "nwse-resize" },
    s: { left: "50%", bottom: -4, marginLeft: -4, cursor: "ns-resize" },
    sw: { left: -4, bottom: -4, cursor: "nesw-resize" },
    w: { left: -4, top: "50%", marginTop: -4, cursor: "ew-resize" },
  };
  return (
    <span
      onPointerDown={onPointerDown}
      className="absolute h-2 w-2 rounded-sm border border-blue-700 bg-white"
      style={pos[handle]}
    />
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.5,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="block text-xs">
      <span className="text-slate-600">{label}</span>
      <Input
        type="number"
        className="mt-0.5 h-8"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </label>
  );
}

const toBoxes = (list: PlacedField[]): Box[] =>
  list.map((f) => ({
    id: f.certificate_field_id,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
  }));

/**
 * Align / distribute / match-size tools. One field aligns to the page;
 * several align to their common bounds. Distribute needs three or more;
 * match size copies the primary (last selected) field's width or height and
 * leaves the QR, which must stay square, untouched.
 */
function AlignTools({
  type,
  fields,
  primaryId,
  onPatchMany,
}: {
  type: CertificateType;
  fields: PlacedField[];
  primaryId: string | null;
  onPatchMany: (updates: Record<string, BoxPatch>) => void;
}) {
  const many = fields.length > 1;
  const align: { mode: AlignMode; label: string; Icon: typeof AlignStartVertical }[] = [
    { mode: "left", label: "Align left", Icon: AlignStartVertical },
    { mode: "hcenter", label: "Align horizontal centres", Icon: AlignCenterVertical },
    { mode: "right", label: "Align right", Icon: AlignEndVertical },
    { mode: "top", label: "Align top", Icon: AlignStartHorizontal },
    { mode: "vmiddle", label: "Align vertical middles", Icon: AlignCenterHorizontal },
    { mode: "bottom", label: "Align bottom", Icon: AlignEndHorizontal },
  ];
  const distribute: { axis: Axis; label: string; Icon: typeof AlignStartVertical }[] = [
    {
      axis: "horizontal",
      label: "Distribute horizontally",
      Icon: AlignHorizontalDistributeCenter,
    },
    { axis: "vertical", label: "Distribute vertically", Icon: AlignVerticalDistributeCenter },
  ];
  const sizable = fields.filter((f) => certificateField(type, f.field_key)?.kind !== "qr");
  const ref = sizable.find((f) => f.certificate_field_id === primaryId) ?? null;
  const btn = "h-8 w-8 p-0";
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-600">
        <span className="font-am-body">አሰላለፍ</span> / Align {many ? "to selection" : "to page"}
      </p>
      <div className="flex flex-wrap gap-1">
        {align.map(({ mode, label, Icon }) => (
          <Button
            key={mode}
            type="button"
            size="sm"
            variant="outline"
            className={btn}
            title={label}
            aria-label={label}
            onClick={() => onPatchMany(alignBoxes(toBoxes(fields), mode))}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}
      </div>
      {many && (
        <div className="flex flex-wrap gap-1">
          {distribute.map(({ axis, label, Icon }) => (
            <Button
              key={axis}
              type="button"
              size="sm"
              variant="outline"
              className={btn}
              title={fields.length < 3 ? `${label} (select 3 or more)` : label}
              aria-label={label}
              disabled={fields.length < 3}
              onClick={() => onPatchMany(distributeBoxes(toBoxes(fields), axis))}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
          {(["width", "height"] as const).map((dim) => {
            const Icon = dim === "width" ? StretchHorizontal : StretchVertical;
            const label = `Match ${dim} of the last selected field`;
            return (
              <Button
                key={dim}
                type="button"
                size="sm"
                variant="outline"
                className={btn}
                title={label}
                aria-label={label}
                disabled={!ref || sizable.length < 2}
                onClick={() =>
                  ref && onPatchMany(matchSize(toBoxes(sizable), dim, ref.certificate_field_id))
                }
              >
                <Icon className="h-4 w-4" />
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Properties for several selected fields: alignment, shared text style, remove. */
function MultiSelectionPanel({
  type,
  fields,
  primaryId,
  onPatchMany,
  onDelete,
  onClear,
}: {
  type: CertificateType;
  fields: PlacedField[];
  primaryId: string | null;
  onPatchMany: (updates: Record<string, Partial<PlacedField>>) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const textFields = fields.filter((f) => {
    const kind = f.binding_mode === "data" ? certificateField(type, f.field_key)?.kind : "text";
    return kind !== "image" && kind !== "qr";
  });
  const first = textFields[0];
  const same = <K extends keyof PlacedField>(k: K): PlacedField[K] | undefined =>
    first && textFields.every((f) => f[k] === first[k]) ? first[k] : undefined;
  const patchText = (p: Partial<PlacedField>) =>
    onPatchMany(Object.fromEntries(textFields.map((f) => [f.certificate_field_id, p])));
  const weight = same("font_weight");
  const style = same("font_style");
  const textAlign = same("text_align");
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            <span className="font-am-body">{fields.length} መስኮች ተመርጠዋል</span>
          </p>
          <p className="text-xs text-slate-500">{fields.length} fields selected</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>

      <AlignTools type={type} fields={fields} primaryId={primaryId} onPatchMany={onPatchMany} />

      {textFields.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-600">
            Text style ({textFields.length} text field{textFields.length === 1 ? "" : "s"})
          </p>
          <label className="block text-xs">
            <span className="text-slate-600">Font</span>
            <Select
              value={same("font_family") ?? ""}
              onValueChange={(v) => patchText({ font_family: v })}
            >
              <SelectTrigger className="mt-0.5 h-8">
                <SelectValue placeholder="Mixed" />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Size (pt)"
              value={same("font_size") ?? first.font_size}
              min={4}
              max={72}
              step={0.5}
              onChange={(v) => patchText({ font_size: v })}
            />
            <label className="block text-xs">
              <span className="text-slate-600">Colour</span>
              <Input
                type="color"
                className="mt-0.5 h-8 p-1"
                value={same("color") ?? first.color}
                onChange={(e) => patchText({ color: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={weight === "bold" ? "default" : "outline"}
              onClick={() => patchText({ font_weight: weight === "bold" ? "normal" : "bold" })}
              aria-label="Bold"
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant={style === "italic" ? "default" : "outline"}
              onClick={() => patchText({ font_style: style === "italic" ? "normal" : "italic" })}
              aria-label="Italic"
            >
              <Italic className="h-4 w-4" />
            </Button>
            {(["left", "center", "right"] as const).map((a) => {
              const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
              return (
                <Button
                  key={a}
                  size="sm"
                  variant={textAlign === a ? "default" : "outline"}
                  onClick={() => patchText({ text_align: a })}
                  aria-label={`Text align ${a}`}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
          </div>
        </div>
      )}

      <Button variant="outline" size="sm" className="w-full text-red-700" onClick={onDelete}>
        <Trash2 className="mr-1 h-4 w-4" /> <span className="font-am-body">አስወግድ</span> / Remove{" "}
        {fields.length}
      </Button>
    </div>
  );
}

function PropertiesPanel({
  type,
  orientation,
  field,
  onPatch,
  onPatchMany,
  onDelete,
}: {
  type: CertificateType;
  orientation: Orientation;
  field: PlacedField | null;
  onPatch: (p: Partial<PlacedField>) => void;
  onPatchMany: (updates: Record<string, Partial<PlacedField>>) => void;
  onDelete: () => void;
}) {
  if (!field) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        <span className="font-am-body">መስክ ይምረጡ</span> / Select a field on the page to edit it.
        Shift- or Ctrl-click (or drag a box) to select several and align them.
      </div>
    );
  }
  const def = field.binding_mode === "data" ? certificateField(type, field.field_key) : undefined;
  const formats: FieldFormat[] = def ? formatsFor(def.kind) : ["plain"];
  const isImage = def?.kind === "image" || def?.kind === "qr";
  const qrMm = def?.kind === "qr" ? Math.round((field.width / 100) * PAGE_MM[orientation].w) : null;
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <p className="font-am-body text-sm font-semibold text-slate-900">{def?.am ?? "ቋሚ ጽሑፍ"}</p>
        <p className="text-xs text-slate-500">{def?.en ?? "Static text"}</p>
        {def && (
          <p className="mt-1 text-[11px] text-slate-500">
            On the page: <span className="font-am-body">{placeholderLabel(def, field.format)}</span>
          </p>
        )}
      </div>

      <AlignTools
        type={type}
        fields={[field]}
        primaryId={field.certificate_field_id}
        onPatchMany={onPatchMany}
      />

      {qrMm !== null && (
        <p
          className={`rounded-md px-2 py-1 text-xs ${
            qrMm < 20 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          QR {qrMm} mm × {qrMm} mm
          {qrMm < 20
            ? " — too small to scan reliably; keep it at 20 mm or more."
            : " — links to the public verification page."}
        </p>
      )}

      {field.binding_mode === "static" && (
        <label className="block text-xs">
          <span className="text-slate-600">ጽሑፍ / Text</span>
          <textarea
            className="mt-0.5 w-full rounded-md border border-slate-300 p-2 text-sm"
            rows={3}
            maxLength={500}
            value={field.static_value ?? ""}
            onChange={(e) => onPatch({ static_value: e.target.value })}
          />
        </label>
      )}

      {formats.length > 1 && (
        <label className="block text-xs">
          <span className="text-slate-600">ቅርጸት / Format</span>
          <Select value={field.format} onValueChange={(v) => onPatch({ format: v as FieldFormat })}>
            <SelectTrigger className="mt-0.5 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {formats.map((f) => (
                <SelectItem key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      {!isImage && (
        <>
          <label className="block text-xs">
            <span className="text-slate-600">Font</span>
            <Select value={field.font_family} onValueChange={(v) => onPatch({ font_family: v })}>
              <SelectTrigger className="mt-0.5 h-8">
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
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Size (pt)"
              value={field.font_size}
              min={4}
              max={72}
              step={0.5}
              onChange={(v) => onPatch({ font_size: v })}
            />
            <label className="block text-xs">
              <span className="text-slate-600">Colour</span>
              <Input
                type="color"
                className="mt-0.5 h-8 p-1"
                value={field.color}
                onChange={(e) => onPatch({ color: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={field.font_weight === "bold" ? "default" : "outline"}
              onClick={() =>
                onPatch({ font_weight: field.font_weight === "bold" ? "normal" : "bold" })
              }
              aria-label="Bold"
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant={field.font_style === "italic" ? "default" : "outline"}
              onClick={() =>
                onPatch({ font_style: field.font_style === "italic" ? "normal" : "italic" })
              }
              aria-label="Italic"
            >
              <Italic className="h-4 w-4" />
            </Button>
            {(["left", "center", "right"] as const).map((a) => {
              const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
              return (
                <Button
                  key={a}
                  size="sm"
                  variant={field.text_align === a ? "default" : "outline"}
                  onClick={() => onPatch({ text_align: a })}
                  aria-label={`Text align ${a}`}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumField
          label="X (%)"
          value={field.x}
          min={0}
          max={100 - field.width}
          onChange={(v) => onPatch({ x: v })}
        />
        <NumField
          label="Y (%)"
          value={field.y}
          min={0}
          max={100 - field.height}
          onChange={(v) => onPatch({ y: v })}
        />
        <NumField
          label="Width (%)"
          value={field.width}
          min={MIN_PCT}
          max={100 - field.x}
          onChange={(v) => onPatch({ width: v })}
        />
        <NumField
          label="Height (%)"
          value={field.height}
          min={MIN_PCT}
          max={100 - field.y}
          onChange={(v) => onPatch({ height: v })}
        />
        <NumField
          label="Layer"
          value={field.z_index}
          min={0}
          max={1000}
          step={1}
          onChange={(v) => onPatch({ z_index: Math.round(v) })}
        />
      </div>

      <Button variant="outline" size="sm" className="w-full text-red-700" onClick={onDelete}>
        <Trash2 className="mr-1 h-4 w-4" /> <span className="font-am-body">አስወግድ</span> / Remove
      </Button>
    </div>
  );
}
