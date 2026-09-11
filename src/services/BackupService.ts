import { db } from "../db/InventoryDB";
import { sanitizeText } from "../models/product";
import type { BackupFile, BackupInvoice, BackupProduct, Invoice, Product } from "../models/types";
import { AppError, ErrCodes } from "./errors";
import { backupFileName } from "../utils/format";
import { blobToDataUrl, dataUrlToBlob } from "./ImageStore";
import { normalizeForComparison } from "../models/product";
import { toast } from "../app/toast";

export const BACKUP_VERSION = 2;

/** خالص: سریال کردن محصولات به ساختار پشتیبان (قابل تست) */
export async function serializeBackup(products: Product[], invoices: Invoice[] = []): Promise<BackupFile> {
  const items: BackupProduct[] = [];
  for (const product of products) {
    let imageDataUrl: string | null = null;
    if (product.image instanceof Blob) {
      try {
        imageDataUrl = await blobToDataUrl(product.image);
      } catch {
        imageDataUrl = null;
      }
    }
    items.push({
      id: product.id,
      name: product.name,
      category: product.category,
      brand: product.brand,
      quantity: product.quantity,
      purchasePrice: product.purchasePrice,
      sellingPrice: product.sellingPrice,
      torobPrice: product.torobPrice,
      listPrice: product.listPrice,
      torobUrl: product.torobUrl,
      torobId: product.torobId,
      imageUrl: product.imageUrl,
      imageDataUrl,
      description: product.description,
      specifications: product.specifications,
      notes: product.notes,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    });
  }
  const invoiceItems: BackupInvoice[] = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    createdAt: inv.createdAt.toISOString(),
    sellerName: inv.sellerName ?? "",
    sellerNationalId: inv.sellerNationalId ?? "",
    sellerPostalCode: inv.sellerPostalCode ?? "",
    sellerPhone: inv.sellerPhone ?? "",
    sellerAddress: inv.sellerAddress ?? "",
    buyerName: inv.buyerName ?? "",
    buyerNationalId: inv.buyerNationalId ?? "",
    buyerPostalCode: inv.buyerPostalCode ?? "",
    buyerPhone: inv.buyerPhone ?? "",
    paymentType: inv.paymentType === "credit" ? "credit" : "cash",
    items: inv.items ?? [],
    total: inv.total ?? 0,
  }));
  const settings = await db.settings.toArray();
  return {
    version: BACKUP_VERSION,
    app: "anbar",
    exportedAt: new Date().toISOString(),
    products: items,
    settings: settings.map((s) => ({ key: s.key, value: s.value })),
    invoices: invoiceItems,
  };
}

/** خالص: اعتبارسنجی و تبدیل رشتهٔ JSON پشتیبان به شیء (قابل تست) */
export function parseBackupText(text: string): BackupFile {
  if (!text || !text.trim()) {
    throw new AppError(ErrCodes.BACKUP_PARSE, "فایل انتخاب‌شده خالی است.", {});
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new AppError(ErrCodes.BACKUP_PARSE, "فایل پشتیبان معتبر نیست (JSON نامعتبر).", err);
  }
  return validateBackupFile(data);
}

/** خالص: اعتبارسنجی ساختار فایل پشتیبان (قابل تست) */
export function validateBackupFile(data: unknown): BackupFile {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AppError(ErrCodes.BACKUP_PARSE, "ساختار فایل پشتیبان معتبر نیست.", data);
  }
  const record = data as Record<string, unknown>;
  if (record.app !== "anbar") {
    throw new AppError(ErrCodes.BACKUP_PARSE, "این فایل توسط این برنامه ساخته نشده است.", data);
  }
  if (typeof record.version !== "number" || (record.version !== 1 && record.version !== BACKUP_VERSION)) {
    throw new AppError(ErrCodes.BACKUP_PARSE, "نسخهٔ فایل پشتیبان پشتیبانی نمی‌شود.", record.version);
  }
  if (!Array.isArray(record.products)) {
    throw new AppError(ErrCodes.BACKUP_PARSE, "فایل پشتیبان شامل محصولات نیست.", data);
  }

  const products: BackupProduct[] = [];
  for (const item of record.products) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const createdAt = typeof rec.createdAt === "string" ? new Date(rec.createdAt) : new Date();
    const updatedAt = typeof rec.updatedAt === "string" ? new Date(rec.updatedAt) : createdAt;
    const importedId = typeof rec.id === "number" && Number.isInteger(rec.id) && rec.id > 0 ? rec.id : 0;
    products.push({
      id: importedId,
      name: sanitizeText(rec.name ?? "", 200),
      category: rec.category == null ? "" : sanitizeText(rec.category, 100),
      brand: rec.brand == null ? "" : sanitizeText(rec.brand, 100),
      quantity: validNumber(rec.quantity, 0, true),
      purchasePrice: nullableNumber(rec.purchasePrice),
      sellingPrice: nullableNumber(rec.sellingPrice),
      torobPrice: nullableNumber(rec.torobPrice),
      listPrice: nullableNumber(rec.listPrice),
      torobUrl: rec.torobUrl == null ? null : sanitizeText(rec.torobUrl, 500),
      torobId: rec.torobId == null ? null : sanitizeText(rec.torobId, 100),
      imageUrl: rec.imageUrl == null ? null : sanitizeText(rec.imageUrl, 2000),
      imageDataUrl: typeof rec.imageDataUrl === "string" ? rec.imageDataUrl : null,
      description: typeof rec.description === "string" ? rec.description : "",
      specifications: Array.isArray(rec.specifications) ? (rec.specifications as { key: string; value: string }[]) : [],
      notes: typeof rec.notes === "string" ? rec.notes : "",
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
  }

  const settings = Array.isArray(record.settings)
    ? (record.settings as { key: string; value: unknown }[]).filter(
        (s) => s && typeof s.key === "string",
      )
    : [];

  const invoices: BackupInvoice[] = [];
  if (Array.isArray(record.invoices)) {
    for (const item of record.invoices) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const createdAt = typeof rec.createdAt === "string" ? new Date(rec.createdAt) : new Date();
      const number = validNumber(rec.number, 0, true);
      const total = nullableNumber(rec.total) ?? 0;
      const invoiceId = typeof rec.id === "number" && Number.isInteger(rec.id) && rec.id > 0 ? rec.id : 0;
      const paymentType: BackupInvoice["paymentType"] = rec.paymentType === "credit" ? "credit" : "cash";
      const items = Array.isArray(rec.items)
        ? (rec.items as { name?: unknown; quantity?: unknown; price?: unknown; productId?: unknown }[])
            .map((it) => ({
              name: sanitizeText(it?.name, 500),
              quantity: validNumber(it?.quantity, 0, true),
              price: nullableNumber(it?.price) ?? 0,
              productId: typeof it?.productId === "number" ? it.productId : null,
            }))
            .filter((it) => it.name && it.quantity > 0 && it.price >= 0)
        : [];
      invoices.push({
        id: invoiceId,
        number,
        createdAt: createdAt.toISOString(),
        sellerName: typeof rec.sellerName === "string" ? rec.sellerName : "",
        sellerNationalId: typeof rec.sellerNationalId === "string" ? rec.sellerNationalId : "",
        sellerPostalCode: typeof rec.sellerPostalCode === "string" ? rec.sellerPostalCode : "",
        sellerPhone: typeof rec.sellerPhone === "string" ? rec.sellerPhone : "",
        sellerAddress: typeof rec.sellerAddress === "string" ? rec.sellerAddress : "",
        buyerName: typeof rec.buyerName === "string" ? rec.buyerName : "",
        buyerNationalId: typeof rec.buyerNationalId === "string" ? rec.buyerNationalId : "",
        buyerPostalCode: typeof rec.buyerPostalCode === "string" ? rec.buyerPostalCode : "",
        buyerPhone: typeof rec.buyerPhone === "string" ? rec.buyerPhone : "",
        paymentType,
        items,
        total,
      });
    }
  }

  return {
    version: BACKUP_VERSION,
    app: "anbar",
    exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : new Date().toISOString(),
    products,
    settings: settings.map((s) => ({ key: s.key, value: primitiveOrNull(s.value) })),
    invoices,
  };
}

function validNumber(value: unknown, fallback: number, integer: boolean): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (integer && !Number.isInteger(n)) return fallback;
  if (n < 0) return fallback;
  return n;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = validNumber(value, Number.NaN, false);
  return Number.isFinite(n) ? n : null;
}

function primitiveOrNull(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

/** تبدیل رکورد پشتیبان به Product آمادهٔ ذخیره */
export function backupProductToProduct(bp: BackupProduct): Product {
  return {
    id: bp.id,
    name: bp.name,
    category: bp.category ?? "",
    brand: bp.brand ?? "",
    quantity: bp.quantity,
    purchasePrice: bp.purchasePrice,
    sellingPrice: bp.sellingPrice,
    torobPrice: bp.torobPrice,
    listPrice: bp.listPrice,
    torobUrl: bp.torobUrl,
    torobId: bp.torobId,
    image: bp.imageDataUrl ? dataUrlToBlob(bp.imageDataUrl) : null,
    imageUrl: bp.imageUrl,
    description: bp.description ?? "",
    specifications: bp.specifications ?? [],
    notes: bp.notes ?? "",
    createdAt: new Date(bp.createdAt),
    updatedAt: new Date(bp.updatedAt),
  };
}

export interface BackupImportPlan {
  toAdd: Product[];
  skippedTorob: number;
  skippedName: number;
  invalid: number;
  details: string[];
}

/**
 * خالص: برنامهٔ واردسازی بر اساس حالت (قابل تست)
 * replace: تمام دادهٔ موجود پاک می‌شود و همهٔ محصولات فایل وارد می‌شوند
 *          (شناسه‌ها هنگام ذخیره دوباره تعیین می‌شوند؛ در نتیجه هیچ تکراری رد نمی‌شود).
 * merge: محصولات تکراری (ترب یا نام) رد می‌شوند و بقیه اضافه می‌شوند.
 */
export async function buildImportPlan(
  backup: BackupFile,
  mode: "replace" | "merge",
  existing: Product[],
): Promise<BackupImportPlan> {
  const plan: BackupImportPlan = { toAdd: [], skippedTorob: 0, skippedName: 0, invalid: 0, details: [] };
  const seenNames = new Set<string>();
  const seenTorob = new Set<string>();

  for (const item of backup.products) {
    const parsed = backupProductToProduct(item);
    if (!parsed.name) {
      plan.invalid++;
      plan.details.push("رد شد: محصول بدون نام.");
      continue;
    }

    const torobKey = parsed.torobId ? normalizeForComparison(parsed.torobId) : "";
    const nameKey = normalizeForComparison(parsed.name);

    if (mode === "merge") {
      const torobDup =
        (torobKey && (seenTorob.has(torobKey) || existing.some((p) => p.torobId && normalizeForComparison(p.torobId) === torobKey))) ||
        false;
      if (torobDup) {
        plan.skippedTorob++;
        plan.details.push(`رد شد (تکرار ترب): ${parsed.name}`);
        continue;
      }
      const nameDup = seenNames.has(nameKey) || existing.some((p) => normalizeForComparison(p.name) === nameKey);
      if (nameDup) {
        plan.skippedName++;
        plan.details.push(`رد شد (تکرار نام): ${parsed.name}`);
        continue;
      }
    }

    if (torobKey) seenTorob.add(torobKey);
    seenNames.add(nameKey);
    plan.toAdd.push(parsed);
  }

  return plan;
}

/** تبدیل رکورد پشتیبان به فاکتور آمادهٔ ذخیره */
export function backupInvoiceToInvoice(bi: BackupInvoice): Invoice {
  return {
    id: 0,
    number: bi.number,
    createdAt: new Date(bi.createdAt),
    sellerName: bi.sellerName ?? "",
    sellerNationalId: bi.sellerNationalId ?? "",
    sellerPostalCode: bi.sellerPostalCode ?? "",
    sellerPhone: bi.sellerPhone ?? "",
    sellerAddress: bi.sellerAddress ?? "",
    buyerName: bi.buyerName ?? "",
    buyerNationalId: bi.buyerNationalId ?? "",
    buyerPostalCode: bi.buyerPostalCode ?? "",
    buyerPhone: bi.buyerPhone ?? "",
    paymentType: bi.paymentType === "credit" ? "credit" : "cash",
    items: bi.items ?? [],
    total: bi.total ?? 0,
  };
}

/** دانلود فایل پشتیبان در مرورگر */
export async function exportBackup(): Promise<Blob> {
  const products = await db.products.toArray();
  const invoices = await db.invoices.toArray();
  const file = await serializeBackup(products, invoices);
  const json = JSON.stringify(file, null, 2);
  const blob = new Blob([json], { type: "application/json; charset=utf-8" });
  return blob;
}

/** دریافت نام فایل پشتیبان */
export function defaultBackupFileName(): string {
  return backupFileName(new Date());
}

/** دانلود متن JSON به‌عنوان فایل (پشتیبان اضطراری) */
export function downloadJsonText(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- پشتیبان‌گیری خودکار ----------

/** بازه پشتیبان‌گیری خودکار (۱۰ روز) */
export const AUTO_BACKUP_INTERVAL_MS = 10 * 24 * 60 * 60 * 1000;
/** کلید تنظیماتِ تاریخ آخرین پشتیبان‌گیری خودکار */
export const LAST_AUTO_BACKUP_KEY = "lastAutoBackupDate";

/** ساخت متن کامل JSON پشتیبان (محصولات، فاکتورها، تنظیمات) */
export async function buildBackupJson(): Promise<string> {
  const products = await db.products.toArray();
  const invoices = await db.invoices.toArray();
  const file = await serializeBackup(products, invoices);
  return JSON.stringify(file, null, 2);
}

/** ارسال پشتیبان به سرور محلی (run.bat) برای ذخیره روی رایانه */
export async function sendBackupToServer(
  json: string,
): Promise<{ ok: boolean; file: string | null; status: number | null }> {
  try {
    const res = await fetch(`${window.location.origin}/backup`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: json,
    });
    if (!res.ok) return { ok: false, file: null, status: res.status };
    const data: unknown = await res.json().catch(() => null);
    const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const file = typeof rec?.file === "string" ? rec.file : null;
    return { ok: true, file, status: res.status };
  } catch {
    return { ok: false, file: null, status: null };
  }
}

/** تاریخ آخرین پشتیبان‌گیری خودکار (در صورت وجود) */
export async function lastAutoBackupDate(): Promise<Date | null> {
  const setting = await db.settings.get(LAST_AUTO_BACKUP_KEY);
  if (typeof setting?.value !== "string") return null;
  const d = new Date(setting.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** آیا نوبت پشتیبان‌گیری خودکار رسیده است؟ */
export async function isAutoBackupDue(): Promise<boolean> {
  const last = await lastAutoBackupDate();
  if (!last) return true;
  return Date.now() - last.getTime() >= AUTO_BACKUP_INTERVAL_MS;
}

/** ثبت زمان لحظه‌ای پشتیبان‌گیری خودکار */
export async function markAutoBackupDone(): Promise<void> {
  await db.settings.put({ key: LAST_AUTO_BACKUP_KEY, value: new Date().toISOString() });
}

export interface AutoBackupResult {
  ok: boolean;
  viaServer: boolean;
  file: string | null;
  message: string;
}

/** انجام پشتیبان‌گیری: ذخیره در پوشهٔ backups (ترجیح) یا دانلود */
export async function performAutoBackup(): Promise<AutoBackupResult> {
  const json = await buildBackupJson();
  const server = await sendBackupToServer(json);
  if (server.ok) {
    await markAutoBackupDone();
    return {
      ok: true,
      viaServer: true,
      file: server.file,
      message: "پشتیبان در پوشهٔ backups روی رایانه ذخیره شد.",
    };
  }
  try {
    downloadJsonText(json, defaultBackupFileName());
    await markAutoBackupDone();
    return {
      ok: true,
      viaServer: false,
      file: null,
      message: "سرور محلی پیدا نشد؛ فایل پشتیبان دانلود شد.",
    };
  } catch (err) {
    console.error("[anbar] خطای دانلود پشتیبان:", err);
    return { ok: false, viaServer: false, file: null, message: "پشتیبان‌گیری خودکار ممکن نشد." };
  }
}

/** بررسی و اجرای پشتیبان‌گیری خودکار هنگام اجرای برنامه */
export async function autoBackupIfDue(): Promise<void> {
  try {
    if (!(await isAutoBackupDue())) return;
    const result = await performAutoBackup();
    if (result.ok) {
      toast(result.message, "success", 6000);
    } else {
      toast(result.message, "error", 8000);
    }
  } catch (err) {
    console.error("[anbar] پشتیبان‌گیری خودکار:", err);
  }
}