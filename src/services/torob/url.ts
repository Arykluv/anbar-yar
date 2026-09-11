import type { TorobUrlInfo } from "./types";

export const TOROB_HOST = "torob.com";

/**
 * بررسی معتبر بودن لینک محصول ترب.
 * فرم‌های پشتیبانی‌شده:
 *   https://torob.com/p/{id}/slug/
 *   https://torob.com/p/{id}
 */
export function isValidTorobUrl(raw: string): boolean {
  const parsed = parseTorobUrl(raw);
  return parsed !== null;
}

/** استخراج اطلاعات از لینک محصول ترب */
export function parseTorobUrl(raw: string): TorobUrlInfo | null {
  const cleaned = String(raw ?? "").trim();
  if (!cleaned) return null;

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }

  if (url.hostname !== TOROB_HOST && !url.hostname.endsWith(`.${TOROB_HOST}`)) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "p") return null;
  const productId = parts[1];
  if (!productId || !/^[a-zA-Z0-9-]+$/.test(productId)) return null;

  const canonical = `https://${TOROB_HOST}/p/${productId}/`;
  let slug: string | undefined;
  if (parts[2]) {
    try {
      slug = decodeURIComponent(parts[2]).trim() || undefined;
    } catch {
      slug = parts[2];
    }
  }
  return {
    url: canonical,
    productId,
    slug,
  };
}