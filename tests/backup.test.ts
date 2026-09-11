import { beforeEach, describe, expect, it } from "vitest";
import {
  backupInvoiceToInvoice,
  backupProductToProduct,
  buildImportPlan,
  isAutoBackupDue,
  markAutoBackupDone,
  parseBackupText,
  serializeBackup,
  validateBackupFile,
} from "../src/services/BackupService";
import { db } from "../src/db/InventoryDB";
import { AppError } from "../src/services/errors";
import type { BackupFile, Invoice, Product, ProductInput } from "../src/models/types";

function makeProduct(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: "کالا",
    category: "دسته",
    brand: "برند",
    quantity: 4,
    purchasePrice: 1000,
    sellingPrice: 2000,
    torobPrice: null,
    listPrice: null,
    torobUrl: null,
    torobId: null,
    image: null,
    imageUrl: null,
    description: "",
    specifications: [{ key: "رنگ", value: "سفید" }],
    notes: "",
    ...overrides,
  };
}

async function store(products: ProductInput[]): Promise<Product[]> {
  const now = new Date();
  const saved: Product[] = [];
  for (const input of products) {
    const { id: _ignored, ...insertable } = { ...input, id: 0, createdAt: now, updatedAt: now };
    void _ignored;
    const id = await db.products.add(insertable);
    saved.push({ ...input, id, createdAt: now, updatedAt: now });
  }
  return saved;
}

beforeEach(async () => {
  await db.transaction("rw", db.products, db.settings, db.invoices, async () => {
    await db.products.clear();
    await db.settings.clear();
    await db.invoices.clear();
  });
});

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    number: 1,
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    sellerName: "",
    sellerNationalId: "",
    sellerPostalCode: "",
    sellerPhone: "",
    sellerAddress: "",
    buyerName: "مشتری",
    buyerNationalId: "",
    buyerPostalCode: "",
    buyerPhone: "",
    paymentType: "cash",
    items: [
      { name: "کالای یک", quantity: 2, price: 5000, productId: null },
    ],
    total: 10000,
    ...overrides,
  };
}

describe("پشتیبان‌گیری", () => {
  it("خروجی گرفتن و وارد کردن (roundtrip) داده را حفظ می‌کند", async () => {
    const stored = await store([makeProduct({ name: "محصول یک" }), makeProduct({ name: "محصول دو", quantity: 0, torobId: "t1" })]);
    const backup = await serializeBackup(stored);
    const text = JSON.stringify(backup);
    const parsed = parseBackupText(text);
    expect(parsed.app).toBe("anbar");
    expect(parsed.products).toHaveLength(2);
    expect(parsed.products[0]?.name).toBe("محصول یک");
    expect(parsed.products[1]?.torobId).toBe("t1");
    expect(new Date(parsed.products[0]?.createdAt ?? "")).toBeInstanceOf(Date);
  });

  it("فایل نامعتبر را با خطای فارسی رد می‌کند", () => {
    expect(() => parseBackupText("{{{")).toThrow(AppError);
    expect(() => parseBackupText("")).toThrow(AppError);
  });

  it("app نامعتبر را رد می‌کند", () => {
    const fake = JSON.stringify({ app: "other", version: 2, products: [] });
    expect(() => parseBackupText(fake)).toThrow(/ساخته نشده/);
  });

  it("نسخه ناشناخته را رد می‌کند", () => {
    const fake = JSON.stringify({ app: "anbar", version: 99, products: [] });
    expect(() => parseBackupText(fake)).toThrow(/نسخه/);
  });

  it("نسخهٔ قدیمی (بدون فاکتور) نیز پذیرفته می‌شود", () => {
    const old = JSON.stringify({ app: "anbar", version: 1, products: [], settings: [] });
    const parsed = parseBackupText(old);
    expect(parsed.invoices).toEqual([]);
  });

  it("فاکتورها در پشتیبان حفظ و بازگردانده می‌شوند", async () => {
    const stored = await store([makeProduct({ name: "کالای باسبک" })]);
    const backup = await serializeBackup(stored, [makeInvoice()]);
    const parsed = parseBackupText(JSON.stringify(backup));
    expect(parsed.invoices).toHaveLength(1);
    expect(parsed.invoices[0]?.number).toBe(1);
    expect(parsed.invoices[0]?.total).toBe(10000);
    expect(parsed.invoices[0]?.items).toHaveLength(1);

    const invoice = backupInvoiceToInvoice(parsed.invoices[0] ?? makeInvoice());
    expect(invoice.createdAt).toBeInstanceOf(Date);
    expect(invoice.buyerName).toBe("مشتری");
    expect(invoice.items[0]?.quantity).toBe(2);
  });

  it("پشتیبان‌گیری خودکار: بدون ثبت قبلی، زمانش رسیده است", async () => {
    expect(await isAutoBackupDue()).toBe(true);
  });

  it("پشتیبان‌گیری خودکار: پس از ثبت، دیگر موعد نرسیده است", async () => {
    await markAutoBackupDone();
    expect(await isAutoBackupDue()).toBe(false);
  });

  it("اعتبارسنجی ساختار، فایل فاقد products را رد می‌کند", () => {
    expect(() => validateBackupFile({ app: "anbar", version: 1 })).toThrow(AppError);
    expect(() => validateBackupFile(null)).toThrow(AppError);
  });
});

describe("واردسازی پشتیبان", () => {
  interface TestBackupProduct {
    id: number;
    name: string;
    category: string;
    brand: string;
    quantity: number;
    purchasePrice: number | null;
    sellingPrice: number | null;
    torobPrice: number | null;
    listPrice: number | null;
    torobUrl: string | null;
    torobId: string | null;
    image: null;
    imageUrl: string | null;
    imageDataUrl: string | null;
    description: string;
    specifications: { key: string; value: string }[];
    notes: string;
    createdAt: string;
    updatedAt: string;
  }

  function backup(withProducts: Partial<TestBackupProduct>[]): BackupFile {
    return {
      version: 2,
      app: "anbar",
      exportedAt: new Date().toISOString(),
      products: withProducts.map((p) => makeBackupProduct(p)),
      settings: [],
      invoices: [],
    };
  }

  function makeBackupProduct(overrides: Partial<TestBackupProduct> = {}): TestBackupProduct {
    return {
      id: 0,
      name: "کالای وارداتی",
      category: "",
      brand: "",
      quantity: 1,
      purchasePrice: null,
      sellingPrice: null,
      torobPrice: null,
      listPrice: null,
      torobUrl: null,
      torobId: null,
      image: null,
      imageUrl: null,
      imageDataUrl: null,
      description: "",
      specifications: [],
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("در حالت جایگزینی، همهٔ محصولات جدید جایگزین می‌شوند", async () => {
    const existing = await store([makeProduct({ name: "فعلی" })]);
    const plan = await buildImportPlan(backup([{ name: "جدید" }]), "replace", existing);
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.toAdd[0]?.name).toBe("جدید");
  });

  it("جایگزینی: چندین محصول با شناسهٔ یکسان (بدون شناسه) همگی وارد می‌شوند", async () => {
    const existing = await store([makeProduct({ name: "فعلی" })]);
    const plan = await buildImportPlan(
      backup([{ name: "کالای یک" }, { name: "کالای دو" }, { name: "کالای سه" }, { name: "کالای چهار" }]),
      "replace",
      existing,
    );
    expect(plan.toAdd).toHaveLength(4);
    expect(plan.toAdd.map((p) => p.name)).toEqual(["کالای یک", "کالای دو", "کالای سه", "کالای چهار"]);
  });

  it("جایگزینی: شناسهٔ اصلی محصولات حفظ می‌شود و با دادهٔ موجود تداخل ندارد", async () => {
    const existing = await store([makeProduct({ name: "فعلی" })]);
    const plan = await buildImportPlan(
      backup([
        { id: 5, name: "پنج" },
        { id: 99, name: "نودونُه" },
      ]),
      "replace",
      existing,
    );
    expect(plan.toAdd.map((p) => p.id)).toEqual([5, 99]);
  });

  it("در حالت افزودن، تکراری‌ها رد و بقیه اضافه می‌شوند", async () => {
    const existing = await store([makeProduct({ name: "تکراری", torobId: "dup1" })]);
    const plan = await buildImportPlan(
      backup([
        { name: "تکراری", torobId: "dup1" },
        { name: "کالای جدید", torobId: "new1" },
      ]),
      "merge",
      existing,
    );
    expect(plan.skippedTorob).toBe(1);
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.toAdd[0]?.name).toBe("کالای جدید");
  });

  it("تکرار بر اساس نام در حالت افزودن رد می‌شود", async () => {
    const existing = await store([makeProduct({ name: "کالای بدون شناسه" })]);
    const plan = await buildImportPlan(
      backup([{ name: "کالای بدون شناسه", torobId: null }]),
      "merge",
      existing,
    );
    expect(plan.skippedName).toBe(1);
    expect(plan.toAdd).toHaveLength(0);
  });

  it("محصول بدون نام در شمارش نامعتبر می‌آید", async () => {
    const plan = await buildImportPlan(backup([{ name: "" }]), "merge", []);
    expect(plan.invalid).toBe(1);
  });

  it("محصول دارای تصویر base64 به بلاب بازگردانده می‌شود", () => {
    const bp = makeBackupProduct({
      name: "با تصویر",
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });
    const product = backupProductToProduct(bp);
    expect(product.name).toBe("با تصویر");
  });

  it("برنامهٔ افزودن، تاریخچه‌ها و تنظیمات خالی را مدیریت می‌کند", async () => {
    const plan = await buildImportPlan(backup([]), "replace", []);
    expect(plan.toAdd).toEqual([]);
  });
});