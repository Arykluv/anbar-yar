import { AppError, ErrCodes } from "./errors";
import { proxyFetchUrl } from "./LocalProxy";

export interface ImageDownloadResult {
  blob: Blob | null;
  error: string | null;
}

interface BlobAttempt {
  ok: boolean;
  blob: Blob | null;
  error: string | null;
}

async function tryFetchBlob(url: string, maxBytes = 12 * 1024 * 1024): Promise<BlobAttempt> {
  try {
    const response = await fetch(url, { credentials: "omit", mode: "cors" });
    if (response.type === "opaque") {
      return { ok: false, blob: null, error: "دانلود تصویر به دلیل محدودیت CORS ممکن نبود." };
    }
    if (!response.ok) {
      return { ok: false, blob: null, error: `تلاش برای دریافت تصویر ناموفق بود (خطای ${response.status}).` };
    }
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      return { ok: false, blob: null, error: "تصویر دریافتی خالی بود." };
    }
    if (blob.size > maxBytes) {
      return { ok: false, blob: null, error: "تصویر دریافتی بیش از حد بزرگ است (حداکثر ۱۲ مگابایت)." };
    }
    return { ok: true, blob, error: null };
  } catch (err) {
    console.error("[anbar] عدم دانلود تصویر:", err);
    return { ok: false, blob: null, error: "دانلود تصویر به دلیل محدودیت مرورگر ممکن نبود." };
  }
}

/**
 * دانلود تصویر و تبدیل به Blob برای ذخیرهٔ محلی (آفلاین).
 * ابتدا مستقیماً تلاش می‌کند؛ اگر به دلیل CORS شکست بخورد از پروکسی محلی (run.bat) مجدداً تلاش می‌کند.
 */
export async function downloadImageToBlob(url: string): Promise<ImageDownloadResult> {
  if (!url) return { blob: null, error: null };
  const direct = await tryFetchBlob(url);
  if (direct.ok) return { blob: direct.blob, error: null };
  const viaProxy = await tryFetchBlob(proxyFetchUrl(url));
  if (viaProxy.ok) return { blob: viaProxy.blob, error: null };
  return { blob: null, error: direct.error };
}

/** تبدیل File انتخاب‌شده توسط کاربر به Blob (برای آپلود تصویر محلی) */
export function fileToBlob(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Blob([reader.result], { type: file.type }));
      } else {
        reject(new AppError(ErrCodes.IMAGE_DOWNLOAD, "خواندن فایل تصویر با مشکل مواجه شد."));
      }
    };
    reader.onerror = () =>
      reject(new AppError(ErrCodes.IMAGE_DOWNLOAD, "خواندن فایل تصویر با مشکل مواجه شد.", reader.error));
    reader.readAsArrayBuffer(file);
  });
}

/** تبدیل Blob به DataURL (برای پشتیبان‌گیری) */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** برعکس: DataURL به Blob */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  try {
    const byteString = atob(match[2] ?? "");
    const mime = match[1] || "application/octet-stream";
    const len = byteString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = byteString.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}