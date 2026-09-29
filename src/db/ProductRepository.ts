import { db } from "../db/InventoryDB";
import { recordPriceHistory } from "../db/SettingsRepository";
import {
  computeAvailability,
  normalizeForComparison,
  sanitizeText,
  validateProductInput,
} from "../models/product";
import type { Availability, Product, ProductInput } from "../models/types";
import { AppError, ErrCodes } from "../services/errors";

/** خطای اعتبارسنجی کاربری */
export class ValidationError extends AppError {
  constructor(messages: string[]) {
    super(ErrCodes.VALIDATION, messages.join(" "), messages);
  }
}

/** نوع کلید تکرار برای تشخیص محصول تکراری */
export type DuplicateKey = { type: "torobId"; value: string } | { type: "name"; value: string };

const sortByName = (a: Product, b: Product) =>
  a.name.localeCompare(b.name, "fa", { sensitivity: "base" });

/**
 * مخزن محصولات بر اساس IndexedDB.
 * فقط منطق خالص (اعتبارسنجی، تشخیص تکرار، محاسبه وضعیت) خارج از این کلاس قرار دارد.
 */
export class ProductRepository {
  async findAll(): Promise<Product[]> {
    return db.products.orderBy("updatedAt").reverse().toArray();
  }

  async findById(id: number): Promise<Product | undefined> {
    return db.products.get(id);
  }

  async findByTorobId(torobId: string): Promise<Product | undefined> {
    if (!torobId) return undefined;
    return db.products.where("torobId").equals(torobId).first();
  }

  async findByNormalizedName(name: string): Promise<Product | undefined> {
    const normalized = normalizeForComparison(name);
    if (!normalized) return undefined;
    const products = await db.products.toArray();
    return products.find((p) => normalizeForComparison(p.name) === normalized);
  }

  /** تمام کلیدهای تکرار احتمالی یک محصول در برابر بانک موجود */
  async findDuplicates(input: Pick<ProductInput, "torobId" | "name">, excludeId?: number): Promise<DuplicateKey[]> {
    const keys: DuplicateKey[] = [];
    if (input.torobId) {
      const hit = await this.findByTorobId(input.torobId);
      if (hit && hit.id !== excludeId) keys.push({ type: "torobId", value: input.torobId });
    }
    if (input.name) {
      const byName = await this.findByNormalizedName(input.name);
      // تکرار نام فقط وقتی معنی دارد که محصول موجود شناسهٔ ترب نداشته باشد
      // (محصولات ترب با شناسهٔ متفاوت را می‌توان هم‌نام نگه داشت)
      if (byName && byName.id !== excludeId && !byName.torobId) {
        keys.push({ type: "name", value: input.name });
      }
    }
    return keys;
  }

  /** ساخت محصول جدید با اعتبارسنجی و تشخیص تکرار */
  async create(input: ProductInput): Promise<Product> {
    const cleaned = this.prepareInput(input);
    const errors = validateProductInput(cleaned);
    if (errors.length > 0) throw new ValidationError(errors);

    const duplicates = await this.findDuplicates(cleaned);
    const torobDuplicate = duplicates.find((d) => d.type === "torobId");
    if (torobDuplicate) {
      throw new AppError(ErrCodes.VALIDATION, "این محصول قبلاً در انبار ثبت شده است.", duplicates);
    }
    if (cleaned.name && duplicates.some((d) => d.type === "name")) {
      throw new AppError(ErrCodes.VALIDATION, "محصولی با این نام قبلاً ثبت شده است.", duplicates);
    }

    const now = new Date();
    const record = { ...cleaned, createdAt: now, updatedAt: now };
    const { id: _ignored, ...insertable } = record as Product;
    void _ignored;
    const id = await db.products.add(insertable);
    return { ...record, id } as Product;
  }

  /** به‌روزرسانی محصول موجود */
  async update(id: number, patch: Partial<ProductInput>): Promise<Product> {
    const existing = await db.products.get(id);
    if (!existing) {
      throw new AppError(ErrCodes.DB, "محصول موردنظر یافت نشد.", { id });
    }
    const next: ProductInput = { ...existing, ...patch };
    const cleaned = this.prepareInput(next);
    const errors = validateProductInput(cleaned);
    if (errors.length > 0) throw new ValidationError(errors);

    const duplicates = await this.findDuplicates(cleaned, id);
    if (duplicates.some((d) => d.type === "torobId")) {
      throw new AppError(ErrCodes.VALIDATION, "این محصول قبلاً در انبار ثبت شده است.", duplicates);
    }
    if (cleaned.name && duplicates.some((d) => d.type === "name")) {
      throw new AppError(ErrCodes.VALIDATION, "محصولی با این نام قبلاً ثبت شده است.", duplicates);
    }

    const updated: Product = { ...existing, ...cleaned, id, updatedAt: new Date() };
    await db.products.put(updated);
    return updated;
  }

  /** تغییر تعداد موجودی (کلید + و -) */
  async adjustQuantity(id: number, delta: number): Promise<Product> {
    const existing = await db.products.get(id);
    if (!existing) {
      throw new AppError(ErrCodes.DB, "محصول موردنظر یافت نشد.", { id });
    }
    const nextQuantity = existing.quantity + delta;
    if (nextQuantity < 0) {
      throw new AppError(ErrCodes.VALIDATION, "موجودی نمی‌تواند منفی باشد.", { delta, quantity: existing.quantity });
    }
    return this.update(id, { quantity: nextQuantity });
  }

  async remove(id: number): Promise<void> {
    const deleted = await db.products.delete(id);
    await db.priceHistory.where("productId").equals(id).delete();
    void deleted;
  }

  /** شمارش‌ها برای داشبورد */
  async stats(): Promise<{ total: number; available: number; unavailable: number }> {
    const total = await db.products.count();
    const [available, unavailable] = await Promise.all([
      db.products.where("quantity").above(0).count(),
      db.products.where("quantity").equals(0).count(),
    ]);
    return { total, available, unavailable };
  }

  /**
   * افزایش (یا کاهش) درصدی یک فیلد قیمت برای محصولاتِ انتخاب‌شده.
   * فقط محصولاتی که قیمتِ آن‌ها موجود باشد تغییر می‌کنند.
   * برای هر تغییر، تاریخچهٔ قیمت ثبت می‌شود. تعداد تغییرات را برمی‌گرداند.
   */
  async changePrices(
    ids: number[],
    field: "purchasePrice" | "sellingPrice" | "listPrice",
    percent: number,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    if (!Number.isFinite(percent)) return 0;
    const factor = 1 + percent / 100;
    let changed = 0;
    await db.transaction("rw", db.products, db.priceHistory, async () => {
      for (const id of ids) {
        const product = await db.products.get(id);
        if (!product) continue;
        const oldValue = product[field];
        if (typeof oldValue !== "number" || !Number.isFinite(oldValue) || oldValue <= 0) continue;
        const newValue = Math.round(oldValue * factor);
        if (newValue === oldValue) continue;
        const updateSpec: Record<string, number | Date> = { updatedAt: new Date() };
        updateSpec[field] = newValue;
        await db.products.update(id, updateSpec as unknown as Parameters<typeof db.products.update>[1]);
        await recordPriceHistory({ productId: id, field, oldValue, newValue, changedAt: new Date() });
        changed++;
      }
    });
    return changed;
  }

  /** لیست دسته‌بندی‌های موجود */
  async categories(): Promise<string[]> {
    const products = await db.products.toArray();
    const set = new Set<string>();
    for (const p of products) {
      const cat = sanitizeText(p.category);
      if (cat) set.add(cat);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fa"));
  }

  private prepareInput(input: ProductInput): ProductInput {
    const rawQuantity = typeof input.quantity === "number" ? input.quantity : Number(input.quantity ?? 0);
    return {
      ...input,
      name: sanitizeText(input.name, 200),
      category: sanitizeText(input.category, 100),
      brand: sanitizeText(input.brand, 100),
      quantity: Number.isFinite(rawQuantity) ? rawQuantity : 0,
      purchasePrice: input.purchasePrice ?? null,
      sellingPrice: input.sellingPrice ?? null,
      torobPrice: input.torobPrice ?? null,
      listPrice: input.listPrice ?? null,
      torobUrl: input.torobUrl ? sanitizeText(input.torobUrl, 500) : null,
      torobId: input.torobId ? sanitizeText(input.torobId, 100) : null,
      image: input.image ?? null,
      imageUrl: input.imageUrl ? sanitizeText(input.imageUrl, 2000) : null,
      description: input.description ?? "",
      specifications: Array.isArray(input.specifications) ? input.specifications : [],
      notes: input.notes ?? "",
    };
  }
}

export const productRepository = new ProductRepository();

export function getAvailability(product: Pick<Product, "quantity">): Availability {
  return computeAvailability(product.quantity);
}

/** مرتب‌سازی‌های پشتیبانی‌شده */
export type SortKey =
  | "newest"
  | "oldest"
  | "price-asc"
  | "price-desc"
  | "qty-asc"
  | "qty-desc"
  | "name";

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const priceOf = (p: Product): number | null => p.sellingPrice ?? p.purchasePrice ?? p.torobPrice ?? null;
  const byPrice = (a: Product, b: Product, asc: boolean): number => {
    const pa = priceOf(a);
    const pb = priceOf(b);
    if (pa !== null && pb !== null) return asc ? pa - pb : pb - pa;
    if (pa !== null) return -1;
    if (pb !== null) return 1;
    return 0;
  };
  const list = [...products];
  switch (sort) {
    case "newest":
      return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    case "oldest":
      return list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    case "price-asc":
      return list.sort((a, b) => byPrice(a, b, true));
    case "price-desc":
      return list.sort((a, b) => byPrice(a, b, false));
    case "qty-asc":
      return list.sort((a, b) => a.quantity - b.quantity);
    case "qty-desc":
      return list.sort((a, b) => b.quantity - a.quantity);
    case "name":
      return list.sort(sortByName);
    default:
      return list;
  }
}

/** فیلترها برای صفحه محصولات */
export interface ProductFilter {
  q: string;
  category: string;
  availability: Availability | "all";
  sort: SortKey;
}

export function filterProducts(products: Product[], filter: ProductFilter): Product[] {
  const q = normalizeForComparison(filter.q);
  let list = products;
  if (filter.availability !== "all") {
    list = list.filter((p) => computeAvailability(p.quantity) === filter.availability);
  }
  if (filter.category) {
    const cat = normalizeForComparison(filter.category);
    list = list.filter((p) => normalizeForComparison(p.category) === cat);
  }
  if (q) {
    list = list.filter(
      (p) =>
        normalizeForComparison(p.name).includes(q) ||
        normalizeForComparison(p.brand).includes(q) ||
        normalizeForComparison(p.category).includes(q),
    );
  }
  return sortProducts(list, filter.sort);
}