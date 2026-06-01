"use client";

// Client-side image compressor. Resizes + recompresses an uploaded image so
// what gets sent to Supabase Storage stays small (typically 30–120 KB for
// product photos) without visible quality loss on the card sizes we render.
//
// Why client-side and not server-side: our upload routes run on Edge, where
// `sharp` and other Node image libs don't work. Doing it in the browser via
// Canvas + WebP also has the bonus that the network upload is small too —
// staff on flaky cafe wifi sees a faster upload.
//
// Defaults tuned for tables + inventory cards (max display width ~400px on
// retina). 1200px gives 3× headroom; quality 0.85 is visually lossless for
// product photos. Falls back to JPEG if the browser can't encode WebP (rare
// — only very old Safari, all current browsers support it).

export interface CompressOptions {
  maxWidth?:  number;  // longest edge, in pixels (default 1200)
  maxHeight?: number;  // optional explicit height cap (default = maxWidth)
  quality?:   number;  // 0..1 (default 0.85)
  /** Preferred output format. WebP is best for photos; we fall back if the
   *  browser can't encode it. */
  format?: "webp" | "jpeg";
}

export async function compressImage(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  const maxW    = opts.maxWidth  ?? 1200;
  const maxH    = opts.maxHeight ?? maxW;
  const quality = opts.quality   ?? 0.85;
  const wantFmt = opts.format    ?? "webp";

  // Bail unchanged for non-images (PDFs etc — shouldn't happen via our UI
  // but defensive in case the upload input accepts something weird).
  if (!file.type.startsWith("image/")) return file;

  // Decode the source image. createImageBitmap honours EXIF orientation
  // automatically (so phone-rotated photos don't end up sideways).
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    // Older Safari doesn't accept the imageOrientation option — retry without
    try { bitmap = await createImageBitmap(file); }
    catch { return file; } // give up — original goes through
  }

  // Compute the target size preserving aspect ratio. Never upscale.
  const ratio = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
  const w = Math.round(bitmap.width  * ratio);
  const h = Math.round(bitmap.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // Try the preferred format, fall back to JPEG if it returns null (encoder
  // not supported — basically only old Safari).
  const targetMime = wantFmt === "webp" ? "image/webp" : "image/jpeg";
  let blob: Blob | null = await canvasToBlob(canvas, targetMime, quality);
  let chosenMime = targetMime;
  if (!blob) {
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
    chosenMime = "image/jpeg";
  }
  if (!blob) return file; // total failure — pass through original

  // Build a new File so the existing FormData upload code keeps working.
  // The name extension matches the actual encoding so server-side content
  // sniffing + Supabase Storage Content-Type stays correct.
  const ext  = chosenMime === "image/webp" ? "webp" : "jpg";
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.${ext}`, {
    type:         chosenMime,
    lastModified: Date.now(),
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}
