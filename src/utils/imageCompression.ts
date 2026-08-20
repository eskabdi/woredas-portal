/**
 * Client-side WebP conversion for the storage upload pipeline.
 *
 * Conversion happens in the browser, before the bytes ever leave the device:
 * a 4 MB phone photo goes up as ~200 KB. That saved upload time is the point —
 * doing this server-side would mean sending the original anyway.
 *
 * Only presentation images go through here. Scanned legal documents keep their
 * original bytes; see convertForUpload's callers.
 */

const WEBP = "image/webp";

/** Formats worth re-encoding. SVG is already small and vector; GIF may animate. */
const CONVERTIBLE = new Set(["image/jpeg", "image/png"]);

let webpEncodingSupported: boolean | null = null;

/**
 * Canvas silently falls back to PNG when it cannot encode a format, so the
 * only reliable check is to encode a pixel and look at what came back.
 */
function supportsWebpEncoding(): boolean {
  if (webpEncodingSupported !== null) return webpEncodingSupported;
  if (typeof document === "undefined") return (webpEncodingSupported = false);
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    webpEncodingSupported = probe.toDataURL(WEBP).startsWith(`data:${WEBP}`);
  } catch {
    webpEncodingSupported = false;
  }
  return webpEncodingSupported;
}

export interface WebpOptions {
  /** Longest edge in pixels. Larger images scale down; smaller ones are left alone. */
  maxDimension: number;
  /** 0–1. Use >= 0.9 for anything that gets printed. */
  quality: number;
}

/** ID photos: shown at ~200px on screen and ~1cm on a printed card. */
export const PHOTO_WEBP: WebpOptions = { maxDimension: 1024, quality: 0.82 };

/**
 * Logos, stamps and signatures. These are printed and often have transparency,
 * so they get a high quality setting and no aggressive downscale.
 */
export const BRANDING_WEBP: WebpOptions = { maxDimension: 1600, quality: 0.92 };

/** ID card background art, printed at card size. Quality over bytes. */
export const TEMPLATE_WEBP: WebpOptions = { maxDimension: 2400, quality: 0.95 };

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, WEBP, quality));
}

/**
 * Re-encodes an image as WebP, downscaling if it exceeds `maxDimension`.
 *
 * Returns the original File unchanged whenever conversion would not help or
 * cannot be trusted: unsupported browser, non-convertible type, or a result
 * that came out larger than what we started with. Callers can treat the
 * return value as "the file to upload" without branching.
 */
export async function toWebp(file: File, opts: WebpOptions): Promise<File> {
  if (!CONVERTIBLE.has(file.type) || !supportsWebpEncoding()) return file;

  try {
    // from-image applies EXIF rotation. Without it, portrait photos from
    // phones — which store landscape pixels plus an orientation flag — get
    // baked in sideways, because drawing to a canvas discards the metadata.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const scale = Math.min(1, opts.maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // No background fill: WebP keeps the alpha channel, and logos and
    // signatures are cut out against the page.
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await encode(canvas, opts.quality);
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], swapExtension(file.name, "webp"), {
      type: WEBP,
      lastModified: Date.now(),
    });
  } catch {
    // A conversion failure must never block the upload itself.
    return file;
  }
}

/** `photo.JPG` → `photo.webp`. Falls back to appending when there is no extension. */
export function swapExtension(fileName: string, extension: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem}.${extension}`;
}

/**
 * The extension to store a file under, derived from its actual type rather
 * than its original name — after conversion the two disagree.
 */
export function storageExtension(file: File, fallback = "bin"): string {
  const fromType = {
    [WEBP]: "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
  }[file.type];
  if (fromType) return fromType;
  const dot = file.name.lastIndexOf(".");
  return dot > 0 ? file.name.slice(dot + 1).toLowerCase() : fallback;
}
