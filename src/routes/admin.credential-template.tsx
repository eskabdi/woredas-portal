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

export const Route = createFileRoute("/admin/credential-template")({
  ssr: false,
  component: CredentialTemplatePage,
});

type Side = "card_front" | "card_back";

interface TemplateRow {
  template_type: Side;
  background_image_url: string | null;
  status: "draft" | "active";
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
  woreda_name: "Woreda",
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

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

// A QR code is a square grid of modules — stretching its bounding box would
// stretch the modules themselves, which is exactly the kind of distortion
// that makes a QR unscannable regardless of how large it prints. Locking the
// resize handles to 1:1 for this field is a print-correctness constraint, not
// a UI nicety.
const ASPECT_LOCKED_FIELD_KEYS = new Set(["qr_code"]);

function CredentialTemplatePage() {
  const isSuper = useAuthStore((s) => s.role === "super_admin");
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const qc = useQueryClient();

  const [activeSide, setActiveSide] = useState<Side>("card_front");
  const [drafts, setDrafts] = useState<Record<string, Partial<FieldRow>>>({});
  const [past, setPast] = useState<Record<string, Partial<FieldRow>>[]>([]);
  const [future, setFuture] = useState<Record<string, Partial<FieldRow>>[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

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
      const { data, error } = await supabase
        .from("id_card_template")
        .select("template_type, background_image_url, status, updated_at");
      if (error) throw error;
      return (data ?? []) as TemplateRow[];
    },
  });

  const fieldsQuery = useQuery({
    queryKey: ["id-card-template-fields"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("id_card_template_field")
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
  }, [undo, redo]);

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
    const { error: dbErr } = await supabase
      .from("id_card_template")
      .update({
        background_image_url: path,
        status: "draft",
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("template_type", side);
    if (dbErr) {
      toast.error(`Save failed: ${dbErr.message}`);
      return;
    }
    toast.success("Background uploaded (draft)");
    qc.invalidateQueries({ queryKey: ["id-card-templates"] });
  };

  const saveDraft = async () => {
    if (!isSuper) return;
    const entries = Object.entries(drafts);
    if (entries.length === 0) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    try {
      for (const [id, patch] of entries) {
        const { error } = await supabase
          .from("id_card_template_field")
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
      toast.success("Draft saved");
      setDrafts({});
      setPast([]);
      setFuture([]);
      qc.invalidateQueries({ queryKey: ["id-card-template-fields"] });
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
      // Persist any pending drafts first
      for (const [id, patch] of Object.entries(drafts)) {
        const { error } = await supabase
          .from("id_card_template_field")
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

      const { error } = await supabase
        .from("id_card_template")
        .update({
          status: "active",
          updated_by: actorUserId,
          updated_at: new Date().toISOString(),
        })
        .in("template_type", ["card_front", "card_back"]);
      if (error) throw error;
      toast.success("Template published");
      setDrafts({});
      setPast([]);
      setFuture([]);
      qc.invalidateQueries({ queryKey: ["id-card-templates"] });
      qc.invalidateQueries({ queryKey: ["id-card-template-fields"] });
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message}`);
    } finally {
      setPublishing(false);
    }
  };

  if (!isSuper) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        Super admin permission required.
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
          {currentTemplate?.status === "active" ? (
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
        />
        <PropertiesPanel field={selected} onPatch={patchField} />
      </div>

      {Object.keys(drafts).length > 0 && (
        <p className="text-xs text-amber-700">
          You have {Object.keys(drafts).length} unsaved change(s). Click “Save Draft” to persist or
          “Publish Template” to activate.
        </p>
      )}
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
}: {
  fields: FieldRow[];
  backgroundUrl: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<FieldRow>, options?: { history?: boolean }) => void;
  onBeginGesture: () => void;
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
}: {
  field: FieldRow | null;
  onPatch: (id: string, patch: Partial<FieldRow>) => void;
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
      <div>
        <h3 className="text-sm font-semibold text-slate-700">Properties</h3>
        <p className="mt-1 text-sm font-medium text-blue-700">{label}</p>
        <p className="font-mono text-[10px] text-slate-400">{field.field_key}</p>
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
