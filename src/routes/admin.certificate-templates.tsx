import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckCircle2,
  Eye,
  FileText,
  GripVertical,
  Italic,
  Loader2,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Send,
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
  type Orientation,
  type PlacedField,
} from "@/components/certificates/certificateLayout";
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
import {
  CERTIFICATE_FIELDS,
  CERTIFICATE_TYPES,
  CERTIFICATE_TYPE_LABELS,
  FIELD_GROUPS,
  FORMAT_LABELS,
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
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface TemplateRow {
  certificate_type: CertificateType;
  background_path: string | null;
  orientation: Orientation;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "publish" | "discard" | "upload">(null);

  const templatesQuery = useQuery({
    queryKey: ["certificate-templates"],
    queryFn: async () => {
      const { data, error } = await db
        .from("certificate_template")
        .select("certificate_type, background_path, orientation, is_published, published_at");
      if (error) throw error;
      return (data ?? []) as TemplateRow[];
    },
  });
  const template = templatesQuery.data?.find((t) => t.certificate_type === type) ?? null;
  const orientation: Orientation = template?.orientation ?? "portrait";

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
    setSelectedId(null);
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
  const selected = fields.find((f) => f.certificate_field_id === selectedId) ?? null;
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
  const insertField = async (fieldKey: string, at?: { x: number; y: number }) => {
    const isStatic = fieldKey === STATIC_FIELD_KEY;
    const def = isStatic ? null : certificateField(type, fieldKey);
    if (!isStatic && !def) return;
    const isImage = def?.kind === "image";
    const width = isImage ? 18 : 30;
    const height = isImage ? 9 : 3;
    const cx = at?.x ?? 50;
    const cy = at?.y ?? 50;
    const maxZ = fields.reduce((m, f) => Math.max(m, f.z_index), 0);
    const { data, error } = await db
      .from("certificate_template_field_draft")
      .insert({
        certificate_type: type,
        field_key: isStatic ? STATIC_FIELD_KEY : fieldKey,
        format: isStatic ? "plain" : defaultFormat(def!.kind),
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
    await audit("CERTIFICATE_TEMPLATE_FIELD_ADDED", { field_key: fieldKey });
    await qc.invalidateQueries({ queryKey: ["certificate-template-drafts", type] });
    qc.invalidateQueries({ queryKey: ["certificate-templates"] });
    setSelectedId(data.certificate_field_id);
  };

  const deleteSelected = useCallback(async () => {
    if (!selectedId) return;
    const removed = fields.find((f) => f.certificate_field_id === selectedId);
    const { data, error } = await db
      .from("certificate_template_field_draft")
      .delete()
      .eq("certificate_field_id", selectedId)
      .select("certificate_field_id")
      .maybeSingle();
    if (error || !data) {
      toast.error(error?.message ?? "Could not remove the field");
      return;
    }
    await audit("CERTIFICATE_TEMPLATE_FIELD_REMOVED", { field_key: removed?.field_key ?? null });
    setPatches(({ [selectedId]: _removed, ...rest }) => rest);
    setSelectedId(null);
    qc.invalidateQueries({ queryKey: ["certificate-template-drafts", type] });
    qc.invalidateQueries({ queryKey: ["certificate-templates"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, fields, type]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        void deleteSelected();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, selectedId, undo, redo]);

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
      setSelectedId(null);
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

  const setOrientation = async (o: Orientation) => {
    try {
      await updateTemplate({ orientation: o });
      await audit("CERTIFICATE_TEMPLATE_ORIENTATION_CHANGED", { orientation: o });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const placedKeys = new Set(fields.map((f) => f.field_key));
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
        <Label className="text-xs">Page</Label>
        <Select value={orientation} onValueChange={(v) => setOrientation(v as Orientation)}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="portrait">A4 portrait</SelectItem>
            <SelectItem value="landscape">A4 landscape</SelectItem>
          </SelectContent>
        </Select>
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
        <FieldPalette type={type} placedKeys={placedKeys} onAdd={(k) => void insertField(k)} />

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
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPatch={patchField}
            onBeginGesture={beginGesture}
            onDropInsert={(k, x, y) => void insertField(k, { x, y })}
          />
          {fieldsQuery.isLoading && <p className="mt-2 text-xs text-slate-500">Loading…</p>}
        </div>

        <PropertiesPanel
          type={type}
          field={selected}
          onPatch={(p) => selected && patchField(selected.certificate_field_id, p)}
          onDelete={() => void deleteSelected()}
        />
      </div>
    </div>
  );
}

function FieldPalette({
  type,
  placedKeys,
  onAdd,
}: {
  type: CertificateType;
  placedKeys: Set<string>;
  onAdd: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const all = CERTIFICATE_FIELDS[type];
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <div className="max-h-[78vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-sm font-semibold text-slate-800">
        <span className="font-am-heading">የመረጃ መስኮች</span> / Data fields
      </p>
      <p className="mb-2 text-xs text-slate-500">Drag onto the page, or click to add.</p>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ፈልግ / Search"
        className="mb-3 h-8"
        aria-label="Search fields"
      />
      {FIELD_GROUPS.map((g) => {
        const items = all.filter((f) => f.group === g.key && (!q || match(f.am) || match(f.en)));
        if (!items.length) return null;
        return (
          <div key={g.key} className="mb-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span className="font-am-body normal-case">{g.am}</span> / {g.en}
            </p>
            <ul className="space-y-1">
              {items.map((f) => (
                <li key={f.key}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", f.key)}
                    onClick={() => onAdd(f.key)}
                    className="flex w-full items-start gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs hover:border-blue-400 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    title={`Add ${f.en}`}
                  >
                    <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="font-am-body block truncate text-slate-800">{f.am}</span>
                      <span className="block truncate text-slate-500">{f.en}</span>
                    </span>
                    {placedKeys.has(f.key) && (
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-600"
                        aria-label="placed"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <button
        type="button"
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", STATIC_FIELD_KEY)}
        onClick={() => onAdd(STATIC_FIELD_KEY)}
        className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-xs hover:border-blue-400 hover:bg-blue-50"
      >
        <Type className="h-3.5 w-3.5 text-slate-500" />
        <span className="font-am-body">ቋሚ ጽሑፍ</span> / Static text
        <Plus className="ml-auto h-3.5 w-3.5 text-slate-400" />
      </button>
    </div>
  );
}

function EditorCanvas({
  type,
  orientation,
  fields,
  backgroundUrl,
  preview,
  selectedId,
  onSelect,
  onPatch,
  onBeginGesture,
  onDropInsert,
}: {
  type: CertificateType;
  orientation: Orientation;
  fields: PlacedField[];
  backgroundUrl: string | null;
  preview: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<PlacedField>, opts?: { history?: boolean }) => void;
  onBeginGesture: () => void;
  onDropInsert: (key: string, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const samples = useMemo(() => sampleValues(type), [type]);

  // pointer delta (px) -> percent of the page
  const toPct = (dxPx: number, dyPx: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return { dx: 0, dy: 0 };
    return { dx: (dxPx / r.width) * 100, dy: (dyPx / r.height) * 100 };
  };

  const startDrag = (e: React.PointerEvent, f: PlacedField) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.certificate_field_id);
    onBeginGesture();
    const start = { px: e.clientX, py: e.clientY, x: f.x, y: f.y };
    const onMove = (ev: PointerEvent) => {
      const { dx, dy } = toPct(ev.clientX - start.px, ev.clientY - start.py);
      onPatch(
        f.certificate_field_id,
        {
          x: round2(Math.max(0, Math.min(100 - f.width, start.x + dx))),
          y: round2(Math.max(0, Math.min(100 - f.height, start.y + dy))),
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

  const startResize = (e: React.PointerEvent, f: PlacedField, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.certificate_field_id);
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

  return (
    <div
      ref={ref}
      onPointerDown={() => onSelect(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const key = e.dataTransfer.getData("text/plain");
        const r = ref.current?.getBoundingClientRect();
        if (!key || !r) return;
        onDropInsert(
          key,
          ((e.clientX - r.left) / r.width) * 100,
          ((e.clientY - r.top) / r.height) * 100,
        );
      }}
      className="mx-auto w-full max-w-[860px] select-none shadow-md ring-1 ring-slate-300"
    >
      <CertificatePage
        type={type}
        orientation={orientation}
        fields={fields}
        values={preview ? samples : null}
        backgroundUrl={backgroundUrl}
        renderOverlay={(f) => {
          const isSel = f.certificate_field_id === selectedId;
          return (
            <div
              onPointerDown={(e) => startDrag(e, f)}
              className={`absolute inset-0 cursor-move border ${
                isSel
                  ? "border-2 border-blue-600 bg-blue-500/10"
                  : "border-dashed border-blue-400/70 hover:border-blue-500"
              }`}
              title={certificateField(type, f.field_key)?.en ?? "Static text"}
            >
              {isSel &&
                (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map((h) => (
                  <ResizeHandle key={h} handle={h} onPointerDown={(e) => startResize(e, f, h)} />
                ))}
            </div>
          );
        }}
      />
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

function PropertiesPanel({
  type,
  field,
  onPatch,
  onDelete,
}: {
  type: CertificateType;
  field: PlacedField | null;
  onPatch: (p: Partial<PlacedField>) => void;
  onDelete: () => void;
}) {
  if (!field) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        <span className="font-am-body">መስክ ይምረጡ</span> / Select a field on the page to edit it.
      </div>
    );
  }
  const def = field.binding_mode === "data" ? certificateField(type, field.field_key) : undefined;
  const formats: FieldFormat[] = def ? formatsFor(def.kind) : ["plain"];
  const isImage = def?.kind === "image";
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <p className="font-am-body text-sm font-semibold text-slate-900">{def?.am ?? "ቋሚ ጽሑፍ"}</p>
        <p className="text-xs text-slate-500">{def?.en ?? "Static text"}</p>
      </div>

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
                  aria-label={`Align ${a}`}
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
