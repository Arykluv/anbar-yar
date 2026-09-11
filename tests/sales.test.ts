import { beforeEach, describe, expect, it } from "vitest";
import { salesRepository } from "../src/db/SalesRepository";
import { productRepository } from "../src/db/ProductRepository";
import { db } from "../src/db/InventoryDB";
import { AppError } from "../src/services/errors";
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

describe("فاکتور فروش", () => {
  it("فاکتور ثبت می‌کند، موجودی کم می‌شود و شماره پیاپی می‌شود", async () => {
    const product = await productRepository.create(makeInput({ name: "هدفون", quantity: 5 }));
    const invoice = await salesRepository.createInvoice([
      { name: "هدفون", quantity: 2, price: 120000, productId: product.id },
    ]);

    expect(invoice.number).toBe(1);
    expect(invoice.total).toBe(240000);
    expect(invoice.items).toHaveLength(1);
    expect((await productRepository.findById(product.id))?.quantity).toBe(3);

    const second = await salesRepository.createInvoice([
      { name: "هدفون", quantity: 1, price: 120000, productId: product.id },
    ]);
    expect(second.number).toBe(2);

    const history = await db.priceHistory.where("productId").equals(product.id).toArray();
    expect(history.length).toBe(2);
    expect(history[1]?.oldValue).toBe(3);
    expect(history[1]?.newValue).toBe(2);
  });

  it("اگر موجودی کم باشد، کل فاکتور رد می‌شود", async () => {
    const product = await productRepository.create(makeInput({ name: "لپ‌تاپ", quantity: 1 }));
    await expect(
      salesRepository.createInvoice([{ name: "لپ‌تاپ", quantity: 3, price: 1000, productId: product.id }]),
    ).rejects.toBeInstanceOf(AppError);

    expect((await productRepository.findById(product.id))?.quantity).toBe(1);
    expect(await salesRepository.listInvoices()).toHaveLength(0);
  });

  it("چند ردیف از یک محصول، مجموعشان با موجودی سنجیده می‌شود (بدون موجودی منفی)", async () => {
    const product = await productRepository.create(makeInput({ name: "پیچ", quantity: 3 }));
    await expect(
      salesRepository.createInvoice([
        { name: "پیچ", quantity: 2, price: 1000, productId: product.id },
        { name: "پیچ", quantity: 2, price: 1200, productId: product.id },
      ]),
    ).rejects.toBeInstanceOf(AppError);

    expect((await productRepository.findById(product.id))?.quantity).toBe(3);
    expect(await salesRepository.listInvoices()).toHaveLength(0);

    const ok = await salesRepository.createInvoice([
      { name: "پیچ", quantity: 2, price: 1000, productId: product.id },
      { name: "پیچ", quantity: 1, price: 1200, productId: product.id },
    ]);
    expect(ok.total).toBe(3200);
    expect((await productRepository.findById(product.id))?.quantity).toBe(0);

    const history = await db.priceHistory.where("productId").equals(product.id).toArray();
    expect(history[0]?.oldValue).toBe(3);
    expect(history[0]?.newValue).toBe(0);
  });

  it("فاکتور خالی رد می‌شود", async () => {
    await expect(salesRepository.createInvoice([])).rejects.toThrow(/خالی/);
  });

  it("تعداد یا قیمت نامعتبر رد می‌شود", async () => {
    await expect(salesRepository.createInvoice([{ name: "کالا", quantity: 0, price: 100, productId: null }])).rejects.toThrow(/تعداد/);
    await expect(salesRepository.createInvoice([{ name: "کالا", quantity: 1, price: -5, productId: null }])).rejects.toThrow(/قیمت/);
  });

  it("کالای بدون اتصال به محصول، موجودی را تغییر نمی‌دهد", async () => {
    const invoice = await salesRepository.createInvoice([
      { name: "سرویس خدمات", quantity: 1, price: 50000, productId: null },
    ]);
    expect(invoice.total).toBe(50000);
    expect(await db.products.count()).toBe(0);
  });

  it("فاکتورهای قبلی به‌صورت نزولی لیست می‌شوند", async () => {
    await salesRepository.createInvoice([{ name: "الف", quantity: 1, price: 10, productId: null }]);
    await salesRepository.createInvoice([{ name: "ب", quantity: 1, price: 20, productId: null }]);
    const list = await salesRepository.listInvoices();
    expect(list.map((i) => i.number)).toEqual([2, 1]);
  });

  it("حذف فاکتور، لیست را به‌روز می‌کند", async () => {
    const a = await salesRepository.createInvoice([{ name: "الف", quantity: 1, price: 10, productId: null }]);
    const b = await salesRepository.createInvoice([{ name: "ب", quantity: 1, price: 20, productId: null }]);
    await salesRepository.deleteInvoice(a.id as number);
    const list = await salesRepository.listInvoices();
    expect(list.map((i) => i.number)).toEqual([2]);
    void b;
  });

  it("شمارهٔ فاکتور بعد از حذف، تکرار نمی‌شود", async () => {
    const first = await salesRepository.createInvoice([{ name: "الف", quantity: 1, price: 10, productId: null }]);
    const second = await salesRepository.createInvoice([{ name: "ب", quantity: 1, price: 20, productId: null }]);
    await salesRepository.deleteInvoice(second.id as number);

    const third = await salesRepository.createInvoice([{ name: "ج", quantity: 1, price: 30, productId: null }]);
    expect(third.number).toBe(3);
    expect(await salesRepository.nextInvoiceNumber()).toBe(4);
    void first;
  });

  it("حذف همهٔ فاکتورها، شمارنده را حفظ می‌کند", async () => {
    await salesRepository.createInvoice([{ name: "الف", quantity: 1, price: 10, productId: null }]);
    const second = await salesRepository.createInvoice([{ name: "ب", quantity: 1, price: 20, productId: null }]);
    await salesRepository.deleteInvoice(second.id as number);

    const next = await salesRepository.createInvoice([{ name: "ج", quantity: 1, price: 30, productId: null }]);
    expect(next.number).toBe(3);
  });

  it("فروشنده به‌صورت پیش‌فرض ابزار آلات شیرعلی است", async () => {
    const invoice = await salesRepository.createInvoice([{ name: "کالا", quantity: 1, price: 100, productId: null }]);
    expect(invoice.sellerName).toBe("ابزار آلات شیرعلی");
    expect(invoice.buyerName).toBe("");
    expect(invoice.paymentType).toBe("cash");
    expect(invoice.sellerNationalId).toBe("");
    expect(invoice.buyerPhone).toBe("");
    expect(invoice.sellerAddress).toBe("");
  });

  it("اطلاعات فروشنده، خریدار و نوع پرداخت را ذخیره می‌کند", async () => {
    const invoice = await salesRepository.createInvoice(
      [{ name: "کالا", quantity: 1, price: 100, productId: null }],
      {
        sellerName: "همکار",
        sellerNationalId: "0012345678",
        sellerPostalCode: "1234567890",
        sellerPhone: "09121234567",
        sellerAddress: "تهران، خیابان انقلاب، پلاک ۱۲",
        buyerName: "مشتری الف",
        buyerNationalId: "0098765432",
        buyerPostalCode: "0987654321",
        buyerPhone: "021-55667788",
        paymentType: "credit",
      },
    );
    expect(invoice.sellerName).toBe("همکار");
    expect(invoice.sellerNationalId).toBe("0012345678");
    expect(invoice.sellerPostalCode).toBe("1234567890");
    expect(invoice.sellerPhone).toBe("09121234567");
    expect(invoice.sellerAddress).toBe("تهران، خیابان انقلاب، پلاک ۱۲");
    expect(invoice.buyerName).toBe("مشتری الف");
    expect(invoice.buyerNationalId).toBe("0098765432");
    expect(invoice.buyerPostalCode).toBe("0987654321");
    expect(invoice.buyerPhone).toBe("021-55667788");
    expect(invoice.paymentType).toBe("credit");
  });
});

describe("HTML فاکتور", () => {
  const invoice = {
    number: 7,
    createdAt: new Date(2026, 8, 6, 12, 30),
    sellerName: "ابزار آلات شیرعلی",
    sellerNationalId: "0012345678",
    sellerPostalCode: "1234567890",
    sellerPhone: "09121234567",
    sellerAddress: "تهران، خیابان انقلاب، پلاک ۱۲",
    buyerName: "شرکت نمونه",
    buyerNationalId: "0098765432",
    buyerPostalCode: "0987654321",
    buyerPhone: "021-55667788",
    paymentType: "credit" as const,
    items: [
      { name: "هدفون بی‌سیم", quantity: 2, price: 120000, productId: null },
      { name: "کابل <USB> & شارژر", quantity: 1, price: 45000, productId: null },
    ],
    total: 285000,
  };

  it("نام کالاها، قیمت‌ها و جمع کل را در HTML می‌آورد", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain("هدفون بی‌سیم");
    expect(html).toContain("کابل &lt;USB&gt; &amp; شارژر");
    expect(html).toContain("۷"); // شمارهٔ فاکتور فارسی
    expect(html).toContain("۲۸۵٬۰۰۰");
  });

  it("اطلاعات فروشنده، خریدار و نوع پرداخت را نشان می‌دهد", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain("ابزار آلات شیرعلی");
    expect(html).toContain("شرکت نمونه");
    expect(html).toContain("غیر نقدی");
  });

  it("کد ملی، کد پستی و تلفن فروشنده و خریدار را نشان می‌دهد", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain("کد ملی: 0012345678");
    expect(html).toContain("کد پستی: 1234567890");
    expect(html).toContain("تلفن: 09121234567");
    expect(html).toContain("آدرس: تهران، خیابان انقلاب، پلاک ۱۲");
    expect(html).toContain("کد ملی: 0098765432");
    expect(html).toContain("کد پستی: 0987654321");
    expect(html).toContain("تلفن: 021-55667788");
  });

  it("ناحیهٔ امضا و قالب A4 دارد", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain("مهر و امضای فروشنده");
    expect(html).toContain("مهر و امضای خریدار");
    expect(html).toContain("size: A4");
  });

  it("فاکتور قدیمی بدون فروشنده، مقدار پیش‌فرض می‌گیرد", () => {
    const html = buildInvoiceHtml({
      ...invoice,
      sellerName: undefined,
      sellerNationalId: undefined,
      sellerPostalCode: undefined,
      sellerPhone: undefined,
      sellerAddress: undefined,
      buyerName: undefined,
      buyerNationalId: undefined,
      buyerPostalCode: undefined,
      buyerPhone: undefined,
      paymentType: undefined,
    });
    expect(html).toContain("ابزار آلات شیرعلی");
    expect(html).toContain("نقدی");
    expect(html).not.toContain("کد ملی:");
    expect(html).not.toContain("آدرس:");
  });

  it("سند RTL و چاپ‌پذیر است", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("@page");
    expect(html).toContain("فروشگاه ابزارآلات شیرعلی");
  });

  it("لوگو (به‌صورت تنبل، خارج از باندل) و عنوان فاکتور را نشان می‌دهد", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain("<title>فروشگاه ابزارآلات شیرعلی");
    expect(html).toContain('class="invoice-logo"');
    expect(html).toContain("height: 76px");
    expect(html).toContain('src=""'); // لوگو به‌صورت تنبل و هنگام چاپ اضافه می‌شود
  });

  it("نوع پرداخت و تعداد اقلام زیر جمع کلی هستند", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html.indexOf("جمع کل")).toBeLessThan(html.indexOf("نوع پرداخت"));
    expect(html.indexOf("نوع پرداخت")).toBeLessThan(html.indexOf("تعداد اقلام"));
  });

  it("خلاصهٔ متنی برای تأیید می‌سازد", () => {
    const summary = invoiceSummaryText(invoice);
    expect(summary).toContain("خریدار: شرکت نمونه");
    expect(summary).toContain("تلفن خریدار: 021-55667788");
    expect(summary).toContain("نوع پرداخت: غیر نقدی");
    expect(summary).toContain("هدفون بی‌سیم");
    expect(summary).toContain("۲ × ۱۲۰٬۰۰۰");
    expect(summary).toContain("جمع کل: ۲۸۵٬۰۰۰");
  });
});