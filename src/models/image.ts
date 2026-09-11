/** بهینه‌سازی تصاویر قبل از ذخیره در بانک محلی (IndexedDB) برای کاهش مصرف حافظه و فضا */

const MAX_DIMENSION = 720;
const JPEG_QUALITY = 0.82;
const SKIP_IF_SMALLER_THAN = 160 * 1024;

/** نمونهٔ اصلی (بدون تغییر) را برمی‌گرداند */
function original(blob: Blob): Promise<Blob> {
  return Promise.resolve(blob);
}

/** بارگیری بلاب به بیت‌مپ */
async function decode(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      /* به مسیر جایگزین می‌رویم */
    }
  }
  return new Promise<ImageBitmap>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img as unknown as ImageBitmap);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function encodeToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * فشرده‌سازی و کوچک‌سازی تصویر.
 * اگر تصویر از قبل سبک و کوچک باشد، همان بلاب اصلی برمی‌گردد تا کیفیت حفظ شود.
 */
export async function compressImage(blob: Blob): Promise<Blob> {
  if (typeof window === "undefined") return original(blob);
  if (blob.size < SKIP_IF_SMALLER_THAN || blob.type === "image/svg+xml" || blob.type === "image/gif") {
    return original(blob);
  }
  if (!/^image\//.test(blob.type)) return original(blob);

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(blob);
  } catch {
    return original(blob);
  }

  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));

    if (scale === 1 && blob.size < 600 * 1024) {
      bitmap.close?.();
      return original(blob);
    }

    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return original(blob);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, outWidth, outHeight);

    const isPhoto = blob.type === "image/jpeg" || blob.type === "image/webp";
    let encoded: Blob | null = null;
    if (isPhoto) {
      encoded = await encodeToBlob(canvas, "image/webp", JPEG_QUALITY);
      if (!encoded) encoded = await encodeToBlob(canvas, "image/jpeg", JPEG_QUALITY);
    } else {
      encoded = await encodeToBlob(canvas, "image/webp", JPEG_QUALITY);
      if (!encoded) encoded = await encodeToBlob(canvas, "image/png", 1);
    }
    if (!encoded || encoded.size >= blob.size) {
      bitmap.close?.();
      return original(blob);
    }
    return encoded;
  } finally {
    bitmap.close?.();
  }
}