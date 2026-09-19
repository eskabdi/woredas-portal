import { Loader2, Upload, X } from "lucide-react";

/**
 * Shared squircle-shaped photo/document upload box (master_design_system.md
 * §3.B). Replaces the two-piece pattern used before this component --
 * a bordered preview box plus a separate "Upload" button below it -- with a
 * single clickable/tappable surface: the preview *is* the drop target, and
 * an empty state shows the upload prompt inline instead of a second control.
 *
 * docs/ux/ux_restructure_plan.md names three call sites this replaces:
 * resident photo, rental occupant documents, civil event supporting docs.
 */
export function SquircleUpload({
  previewUrl,
  uploading,
  labelAm,
  labelEn,
  accept = "image/*",
  shape = "square",
  size = 160,
  onFileSelect,
  onRemove,
}: {
  /** Signed URL (or object URL) of the current file, if one is set. */
  previewUrl?: string | null;
  uploading?: boolean;
  labelAm: string;
  labelEn: string;
  accept?: string;
  /** "circle" for a headshot-style photo, "square" (squircle) for a document. */
  shape?: "circle" | "square";
  /** Box side length in px. */
  size?: number;
  onFileSelect: (file: File) => void;
  onRemove?: () => void;
}) {
  const radius = shape === "circle" ? "9999px" : "28%";

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <label
        className="group relative flex cursor-pointer items-center justify-center overflow-hidden border-2 border-dashed border-slate-300 bg-slate-50/80 transition-colors hover:border-blue-600 hover:bg-white"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {previewUrl ? (
          <>
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onRemove();
                }}
                aria-label="Remove"
                className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-2 text-center">
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            ) : (
              <Upload className="h-6 w-6 text-slate-400 group-hover:text-blue-600" />
            )}
            <span className="font-am-body text-xs leading-tight text-slate-500">{labelAm}</span>
            <span className="text-[11px] leading-tight text-slate-400">/ {labelEn}</span>
          </div>
        )}
        {uploading && previewUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
        <input
          type="file"
          accept={accept}
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileSelect(f);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
