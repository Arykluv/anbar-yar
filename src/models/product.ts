import type { Availability, ProductInput, Specification } from "./types";

/** کاراکترهای مجاز برای فیلدهای متنی ساده */
const TEXT_MAX_LENGTH = 500;
const NOTE_MAX_LENGTH = 4000;
const FIELD_MAX_LENGTH = 200;
const DESC_MAX_LENGTH = 8000;

/** نمایشی امن از تصاویر بلاب روی صفحه */
const objectUrlCache = new WeakMap<Blob, string>();

export function blobToObjectUrl(blob: Blob): string {
  const cached = objectUrlCache.get(blob);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(blob, url);
  return url;
}

/** پاک‌سازی متن خارجی/کاربری: حذف کاراکترهای کنترلی و محدود کردن طول */
export function sanitizeText(value: unknown, max = FIELD_MAX_LENGTH): string {
  if (value === null || value === undefined) return "";
  const str = String(value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return str.slice(0, max);
}

/** پاک‌سازی متن چندخطی (توضیحات / یادداشت) */
export function sanitizeLongText(value: unknown, max = DESC_MAX_LENGTH): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

/** تبدیل اعداد فارسی/عربی/جداسازها به عدد؛ خروجی null در صورت نامعتبر */
export function parseNumericInput(value: string): number | null {
  if (value.trim() === "") return null;
  let normalized = value
    .trim()
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u066B/g, ".")
    .replace(/[\s\u066C,،]/g, "");
  const n = Number(normalized);
  if (Number.isNaN(n) || !Number.isFinite(n)) return null;
  return n;
}

/** تبدیل ورودی به قیمت (عدد غیرمنفی یا null) */
export function parsePriceInput(value: string): number | null {
  const n = parseNumericInput(value);
  if (n === null) return null;
  if (n < 0) return null;
  return n;
}

/** تبدیل ورودی به موجودی (عدد صحیح غیرمنفی)؛ null یعنی نامعتبر */
export function parseQuantityInput(value: string): number | null {
  const n = parseNumericInput(value);
  if (n === null) return null;
  if (!Number.isInteger(n)) return null;
  if (n < 0) return null;
  return n;
}

/** وضعیت موجودی بر اساس تعداد */
export function computeAvailability(quantity: number): Availability {
  return quantity > 0 ? "available" : "unavailable";
}

/** بررسی اعتبار یک محصول ورودی؛ خروجی: لیست پیام‌های خطا (فارسی) */
export function validateProductInput(input: Partial<ProductInput>): string[] {
  const errors: string[] = [];

  const name = sanitizeText(input.name);
  if (!name) errors.push("نام محصول الزامی است.");
  if (name.length > FIELD_MAX_LENGTH) errors.push("نام محصول خیلی طولانی است.");

  if (input.quantity === undefined || input.quantity === null) {
    errors.push("موجودی الزامی است.");
  } else if (typeof input.quantity !== "number") {
    errors.push("موجودی باید عدد باشد.");
  } else if (!Number.isInteger(input.quantity)) {
    errors.push("موجودی باید عدد صحیح باشد.");
  } else if (input.quantity < 0) {
    errors.push("موجودی نمی‌تواند منفی باشد.");
  }

  const checkPrice = (label: string, value: number | null | undefined) => {
    if (value === null || value === undefined) return;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push(`${label} نمی‌تواند منفی یا نامعتبر باشد.`);
    }
  };
  checkPrice("قیمت خرید", input.purchasePrice);
  checkPrice("قیمت فروش", input.sellingPrice);
  checkPrice("قیمت ترب", input.torobPrice);
  checkPrice("قیمت در لیست", input.listPrice);

  const specs = Array.isArray(input.specifications) ? input.specifications : [];
  for (const spec of specs) {
    if (!spec || typeof spec.key !== "string" || typeof spec.value !== "string") {
      errors.push("فرمت مشخصات کالا معتبر نیست.");
      break;
    }
  }

  return errors;
}

export const LIMITS = {
  FIELD_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  DESC_MAX_LENGTH,
};

/** نرمال‌سازی نام جهت تشخیص تکرار محصول */
export function normalizeForComparison(value: string): string {
  return sanitizeText(value)
    .replace(/[\s\u200c\u200d]+/g, "")
    .replace(/["'%«»]/g, "")
    .toLowerCase();
}

/** بررسی مشخصات از نوع نامعتبر */
export function sanitizeSpecifications(raw: unknown): Specification[] {
  if (!Array.isArray(raw)) return [];
  const specs: Specification[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const key = sanitizeText(rec.key);
    const value = sanitizeLongText(rec.value, TEXT_MAX_LENGTH);
    if (key) specs.push({ key, value });
  }
  return specs;
}