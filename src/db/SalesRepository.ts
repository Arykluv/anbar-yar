import { db } from "./InventoryDB";
import { recordPriceHistory } from "./SettingsRepository";
import { AppError, ErrCodes } from "../services/errors";
import type { Invoice, InvoiceItem, PaymentType } from "../models/types";

/** نام فروشندهٔ پیش‌فرض فاکتور (به‌صورت خالی؛ کاربر خودش تکمیل می‌کند) */
export const DEFAULT_SELLER_NAME = "";

/** کلید شمارندهٔ فاکتور در جدول settings؛ حذف فاکتورها این شمارنده را عقب نمی‌برد */
export const LAST_INVOICE_NUMBER_KEY = "lastInvoiceNumber";

/** مشخصات فروشندهٔ پیش‌فرض فاکتور (خالی) */
export const DEFAULT_SELLER_POSTAL_CODE = "";
export const DEFAULT_SELLER_PHONE = "";
export const DEFAULT_SELLER_ADDRESS = "";

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  cash: "نقدی",
  credit: "غیر نقدی",
};

/** ورودی یک ردیف سبد فروش */
export interface SaleItem {
  name: string;
  quantity: number;
  price: number;
  productId: number | null;
}

/** اطلاعات تکمیلی یک فاکتور در هنگام ثبت */
export interface InvoiceDetails {
  sellerName?: string;
  sellerNationalId?: string;
  sellerPostalCode?: string;
  sellerPhone?: string;
  sellerAddress?: string;
  buyerName?: string;
  buyerNationalId?: string;
  buyerPostalCode?: string;
  buyerPhone?: string;
  paymentType?: PaymentType;
}

/** پاک‌سازی عدد تعداد: عدد صحیح مثبت یا null */
function cleanQuantity(value: unknown): number | null {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/** پاک‌سازی عدد قیمت: عدد غیرمنفی (تومان) یا null */
function cleanPrice(value: unknown): number | null {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (n < 0 || !Number.isFinite(n)) return null;
  return n;
}

function cleanName(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.slice(0, 500);
}

/** پاک‌سازی رشته‌های کوتاه (کد ملی، کد پستی، تلفن) */
function cleanShort(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.replace(/\s+/g, " ").slice(0, 50);
}

/**
 * مخزن فاکتورهای فروش.
 * هنگام «ثبت فروش» موجودی محصولاتِ مرتبط به‌صورت تراکنشی کم می‌شود و
 * تغییر موجودی هر محصول در تاریخچهٔ قیمت ثبت می‌شود.
 */
export class SalesRepository {
  /** شمارهٔ بعدی فاکتور (به‌صورت پیاپی؛ حذف فاکتور آن را عقب نمی‌برد) */
  async nextInvoiceNumber(): Promise<number> {
    return (await this.lastAllocatedNumber()) + 1;
  }

  /** آخرین شمارهٔ اختصاص‌یافته؛ از شمارنده یا بالاترین فاکتور موجود */
  private async lastAllocatedNumber(): Promise<number> {
    const setting = await db.settings.get(LAST_INVOICE_NUMBER_KEY);
    if (typeof setting?.value === "number" && Number.isFinite(setting.value)) return setting.value;
    const last = await db.invoices.orderBy("number").last();
    return last?.number ?? 0;
  }

  async listInvoices(): Promise<Invoice[]> {
    return db.invoices.orderBy("createdAt").reverse().toArray();
  }

  async findById(id: number): Promise<Invoice | undefined> {
    return db.invoices.get(id);
  }

  /** حذف یک فاکتور از تاریخچه (شمارهٔ فاکتورهای بعدی تغییری نمی‌کند) */
  async deleteInvoice(id: number): Promise<void> {
    await db.invoices.delete(id);
  }

  /** اعتبارسنجی آیتم‌های فاکتور قبل از ثبت */
  validateItems(rawItems: SaleItem[]): InvoiceItem[] {
    const items: InvoiceItem[] = [];
    for (const raw of rawItems.slice(0, 200)) {
      const name = cleanName(raw?.name);
      const quantity = cleanQuantity(raw?.quantity);
      const price = cleanPrice(raw?.price);
      if (!name) continue;
      if (quantity === null) {
        throw new AppError(ErrCodes.VALIDATION, `تعدادِ «${name}» باید عدد صحیحِ بزرگ‌تر از صفر باشد.`);
      }
      if (price === null) {
        throw new AppError(ErrCodes.VALIDATION, `قیمتِ «${name}» نمی‌تواند منفی باشد.`);
      }
      items.push({
        name,
        quantity,
        price,
        productId: raw?.productId && typeof raw.productId === "number" ? raw.productId : null,
      });
    }
    if (items.length === 0) {
      throw new AppError(ErrCodes.VALIDATION, "فاکتور خالی است؛ حداقل یک کالا اضافه کنید.");
    }
    return items;
  }

  /**
   * ثبت نهایی فروش: کاهش موجودی، ثبت تاریخچه و ذخیرهٔ فاکتور — به‌صورت تراکنشی.
   * اگر موجودیِ یک محصول از مقدار فروخته‌شده کمتر باشد، کل فاکتور رد می‌شود.
   */
  async createInvoice(rawItems: SaleItem[], details: InvoiceDetails = {}): Promise<Invoice> {
    const items = this.validateItems(rawItems);
    const sellerName = cleanName(details.sellerName) || DEFAULT_SELLER_NAME;
    const buyerName = cleanName(details.buyerName);
    const paymentType: PaymentType = details.paymentType === "credit" ? "credit" : "cash";
    const sellerParty = {
      sellerNationalId: cleanShort(details.sellerNationalId),
      sellerPostalCode: cleanShort(details.sellerPostalCode),
      sellerPhone: cleanShort(details.sellerPhone),
      sellerAddress: cleanName(details.sellerAddress),
    };
    const buyerParty = {
      buyerNationalId: cleanShort(details.buyerNationalId),
      buyerPostalCode: cleanShort(details.buyerPostalCode),
      buyerPhone: cleanShort(details.buyerPhone),
    };

    return db.transaction("rw", db.invoices, db.products, db.priceHistory, db.settings, async () => {
      // مجموع فروش هر محصول (برای جلوگیری از موجودی منفی هنگام چند ردیف از یک محصول)
      const required = new Map<number, number>();
      for (const item of items) {
        if (item.productId === null) continue;
        required.set(item.productId, (required.get(item.productId) ?? 0) + item.quantity);
      }

      for (const [productId, need] of required) {
        const product = await db.products.get(productId);
        if (!product) {
          const name = items.find((i) => i.productId === productId)?.name ?? "؟";
          throw new AppError(ErrCodes.DB, `محصولِ «${name}» یافت نشد.`);
        }
        if (need > product.quantity) {
          throw new AppError(
            ErrCodes.VALIDATION,
            `موجودیِ «${product.name}» کافی نیست (موجودی: ${product.quantity}، درخواست: ${need}).`,
            { stock: product.quantity, need },
          );
        }
      }

      for (const [productId, need] of required) {
        const product = await db.products.get(productId);
        if (!product) continue;
        const newQuantity = product.quantity - need;
        await db.products.update(product.id, { quantity: newQuantity, updatedAt: new Date() });
        await recordPriceHistory({
          productId: product.id,
          field: "quantity",
          oldValue: product.quantity,
          newValue: newQuantity,
          changedAt: new Date(),
        });
      }

      const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
      const number = (await this.lastAllocatedNumber()) + 1;
      const createdAt = new Date();
      const invoice: Invoice = {
        number,
        createdAt,
        sellerName,
        buyerName,
        paymentType,
        items,
        total,
        ...sellerParty,
        ...buyerParty,
      };
      const id = await db.invoices.add(invoice);
      await db.settings.put({ key: LAST_INVOICE_NUMBER_KEY, value: number });
      return { ...invoice, id };
    });
  }
}

export const salesRepository = new SalesRepository();

export interface SellerInfo {
  name: string;
  nationalId: string;
  postalCode: string;
  phone: string;
  address: string;
}

const SAVED_SELLER_KEY = "savedSellerInfo";

export async function getSavedSeller(): Promise<SellerInfo | null> {
  try {
    const setting = await db.settings.get(SAVED_SELLER_KEY);
    if (typeof setting?.value !== "string") return null;
    const data = JSON.parse(setting.value) as Record<string, unknown>;
    if (typeof data !== "object" || data === null) return null;
    const s = (v: unknown): string => (typeof v === "string" ? v : "");
    return {
      name: s(data.name),
      nationalId: s(data.nationalId),
      postalCode: s(data.postalCode),
      phone: s(data.phone),
      address: s(data.address),
    };
  } catch {
    return null;
  }
}

export async function saveSeller(info: SellerInfo): Promise<void> {
  try {
    await db.settings.put({ key: SAVED_SELLER_KEY, value: JSON.stringify(info) });
  } catch {
    /* ذخیره نشد؛ دفعهٔ بعد دوباره تلاش می‌شود */
  }
}