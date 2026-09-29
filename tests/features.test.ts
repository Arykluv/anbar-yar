import { beforeEach, describe, expect, it } from "vitest";
import { productRepository } from "../src/db/ProductRepository";
import { salesRepository } from "../src/db/SalesRepository";
import { db } from "../src/db/InventoryDB";
import { buildXlsx } from "../src/utils/xlsx";
import { serializeBackup, parseBackupText, backupInvoiceToInvoice } from "../src/services/BackupService";
import { buildInvoiceHtml, invoiceSummaryText } from "../src/services/InvoiceService";
import type { ProductInput } from "../src/models/types";

function makeInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: "کالای آزمایشی",
    category: "",
    brand: "",
    quantity: 10,
    purchasePrice: 100000,
    sellingPrice: 120000,
    torobPrice: null,
    listPrice: 110000,
    torobUrl: null,
    torobId: null,
    image: null,
    imageUrl: null,
    description: "",
    specifications: [],
    notes: "",
    ...overrides,
  };
}

beforeEach(async () => {
  await db.transaction("rw", db.products, db.priceHistory, db.settings, db.invoices, async () => {
    await db.products.clear();
    await db.priceHistory.clear();
    await db.settings.clear();
    await db.invoices.clear();
  });
});

describe("افزایش قیمت گروهی", () => {
  it("قیمت فروش محصولاتِ انتخاب‌شده را درصدی بالا می‌برد و تاریخچه ثبت می‌کند", async () => {
    const a = await productRepository.create(makeInput({ name: "کالا یک", sellingPrice: 100000 }));
    const b = await productRepository.create(makeInput({ name: "کالا دو", sellingPrice: 200000 }));

    const changed = await productRepository.changePrices([a.id, b.id], "sellingPrice", 10);

    expect(changed).toBe(2);
    expect((await productRepository.findById(a.id))?.sellingPrice).toBe(110000);
    expect((await productRepository.findById(b.id))?.sellingPrice).toBe(220000);

    const history = await db.priceHistory.where("productId").equals(a.id).toArray();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ field: "sellingPrice", oldValue: 100000, newValue: 110000 });
  });

  it("فقط روی محصولِ انتخاب‌شده اعمال می‌کند", async () => {
    const a = await productRepository.create(makeInput({ name: "کالا یک", sellingPrice: 100000 }));
    const b = await productRepository.create(makeInput({ name: "کالا دو", sellingPrice: 200000 }));

    const changed = await productRepository.changePrices([a.id], "sellingPrice", 10);

    expect(changed).toBe(1);
    expect((await productRepository.findById(a.id))?.sellingPrice).toBe(110000);
    expect((await productRepository.findById(b.id))?.sellingPrice).toBe(200000);
  });

  it("درصد منفی یعنی کاهش قیمت", async () => {
    const a = await productRepository.create(makeInput({ name: "کالا یک", sellingPrice: 100000 }));
    await productRepository.changePrices([a.id], "sellingPrice", -10);
    expect((await productRepository.findById(a.id))?.sellingPrice).toBe(90000);
  });

  it("محصولِ بدون قیمت تغییر نمی‌کند", async () => {
    const a = await productRepository.create(makeInput({ name: "کالا یک", sellingPrice: null }));
    const changed = await productRepository.changePrices([a.id], "sellingPrice", 10);
    expect(changed).toBe(0);
  });
});

describe("تخفیف فاکتور", () => {
  it("مبلغ نهایی مبلغ کل منهای تخفیف است", async () => {
    const product = await productRepository.create(makeInput({ sellingPrice: 200000 }));

    const invoice = await salesRepository.createInvoice(
      [{ name: product.name, quantity: 2, price: 200000, productId: product.id }],
      { discountPercent: 10, buyerName: "فروشگاه نمونه" },
    );

    expect(invoice.subtotal).toBe(400000);
    expect(invoice.discountAmount).toBe(40000);
    expect(invoice.total).toBe(360000);
    expect(invoice.discountPercent).toBe(10);
  });

  it("بدون تخفیف، مبلغ نهایی برابر مجموع کالاهاست", async () => {
    const product = await productRepository.create(makeInput({ sellingPrice: 200000 }));

    const invoice = await salesRepository.createInvoice([
      { name: product.name, quantity: 2, price: 200000, productId: product.id },
    ]);

    expect(invoice.discountPercent ?? 0).toBe(0);
    expect(invoice.discountAmount ?? 0).toBe(0);
    expect(invoice.total).toBe(400000);
  });

  it("درصد بیشتر از صد، به صد بریده می‌شود", async () => {
    const product = await productRepository.create(makeInput({ sellingPrice: 100000 }));

    const invoice = await salesRepository.createInvoice(
      [{ name: product.name, quantity: 1, price: 100000, productId: product.id }],
      { discountPercent: 130 },
    );

    expect(invoice.discountPercent).toBe(100);
    expect(invoice.discountAmount).toBe(100000);
    expect(invoice.total).toBe(0);
  });

  it("در HTML فاکتور ردیف تخفیف و مبلغ نهایی نمایش داده می‌شود", () => {
    const html = buildInvoiceHtml({
      number: 1,
      createdAt: new Date("2026-01-01"),
      items: [{ name: "کالا", quantity: 2, price: 100000, productId: 1 }],
      total: 180000,
      subtotal: 200000,
      discountPercent: 10,
      discountAmount: 20000,
    });

    expect(html).toContain("تخفیف (۱۰٪)");
    expect(html).toContain("مبلغ قابل پرداخت");
    expect(html).toContain("−۲۰٬۰۰۰ تومان");
  });

  it("خلاصهٔ متنی فاکتور درصد و مبلغ نهایی را نشان می‌دهد", () => {
    const text = invoiceSummaryText({
      number: 1,
      items: [{ name: "کالا", quantity: 2, price: 100000, productId: 1 }],
      total: 180000,
      subtotal: 200000,
      discountPercent: 10,
      discountAmount: 20000,
    });

    expect(text).toContain("تخفیف (۱۰٪): −۲۰٬۰۰۰ تومان");
    expect(text).toContain("مبلغ قابل پرداخت: ۱۸۰٬۰۰۰ تومان");
  });
});

describe("خروجی اکسل", () => {
  it("یک فایل ZIP با ساختار xlsx تولید می‌کند", async () => {
    const blob = buildXlsx([
      ["ردیف", "نام کالا", "قیمت"],
      [1, "هدفون بی‌سیم", 1250000],
      [2, "کیبورد", null],
    ]);

    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const text = new TextDecoder().decode(bytes);

    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    expect(text).toContain("[Content_Types].xml");
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("<worksheet");
    expect(text).toContain("هدفون بی‌سیم");
    expect(text).toContain("1250000");

    expect(text.split("PK\x03\x04").length - 1).toBe(5);
  });
});

describe("پشتیبان‌گیری تخفیف", () => {
  it("مقادیر تخفیف در پشتیبان ذخیره و دوباره بازیابی می‌شود", async () => {
    const product = await productRepository.create(makeInput({ sellingPrice: 200000 }));
    const invoice = await salesRepository.createInvoice(
      [{ name: product.name, quantity: 1, price: 200000, productId: product.id }],
      { discountPercent: 15, buyerName: "مشتری نمونه" },
    );

    const file = await serializeBackup([product], [invoice]);
    const parsed = parseBackupText(JSON.stringify(file));
    const back = backupInvoiceToInvoice(parsed.invoices[0]);

    expect(back.subtotal).toBe(200000);
    expect(back.discountPercent).toBe(15);
    expect(back.discountAmount).toBe(30000);
    expect(back.total).toBe(170000);
  });
});