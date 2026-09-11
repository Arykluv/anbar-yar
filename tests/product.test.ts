import { describe, expect, it } from "vitest";
import {
  computeAvailability,
  normalizeForComparison,
  parsePriceInput,
  parseQuantityInput,
  sanitizeSpecifications,
  sanitizeText,
  validateProductInput,
} from "../src/models/product";

describe("اعتبارسنجی موجودی و قیمت", () => {
  it("تعداد منفی را می‌پذیرد: نامعتبر", () => {
    expect(parseQuantityInput("-5")).toBeNull();
  });

  it("تعداد اعشاری را نامعتبر می‌کند", () => {
    expect(parseQuantityInput("3.5")).toBeNull();
  });

  it("تعداد معتبر صحیح را می‌پذیرد", () => {
    expect(parseQuantityInput("42")).toBe(42);
  });

  it("تعداد فارسی را نرمال می‌کند", () => {
    expect(parseQuantityInput("۱۲")).toBe(12);
  });

  it("قیمت منفی نامعتبر است", () => {
    expect(parsePriceInput("-10")).toBeNull();
  });

  it("قیمت با جداساز هزارگان خوانده می‌شود", () => {
    expect(parsePriceInput("۱٬۲۳۴٬۵۶۷")).toBe(1234567);
  });

  it("متن خالی برای قیمت null است", () => {
    expect(parsePriceInput("")).toBeNull();
  });

  it("فاصلهٔ درون عدد به‌عنوان جداساز نادیده گرفته می‌شود", () => {
    expect(parsePriceInput("1 234 567")).toBe(1234567);
    expect(parsePriceInput("۱ ۲۳۴")).toBe(1234);
  });

  it("جداساز هزارگان عربی و فارسی خوانده می‌شود", () => {
    expect(parsePriceInput("1,234")).toBe(1234);
    expect(parsePriceInput("١٬٢٣٤")).toBe(1234);
  });
});

describe("وضعیت موجودی", () => {
  it("صفر = ناموجود", () => {
    expect(computeAvailability(0)).toBe("unavailable");
  });

  it("بیشتر از صفر = موجود", () => {
    expect(computeAvailability(1)).toBe("available");
  });
});

describe("اعتبارسنجی محصول", () => {
  const valid = {
    name: "هدفون بی‌سیم",
    quantity: 5,
    purchasePrice: 100000,
    sellingPrice: 150000,
    torobPrice: null,
    listPrice: null,
    torobUrl: null,
    torobId: null,
    image: null,
    imageUrl: null,
    category: "",
    brand: "",
    description: "",
    specifications: [],
    notes: "",
  };

  it("محصول معتبر بدون خطاست", () => {
    expect(validateProductInput(valid)).toEqual([]);
  });

  it("نام خالی خطا می‌دهد", () => {
    const errors = validateProductInput({ ...valid, name: "   " });
    expect(errors.some((e) => e.includes("نام"))).toBe(true);
  });

  it("تعداد منفی خطا می‌دهد", () => {
    const errors = validateProductInput({ ...valid, quantity: -3 });
    expect(errors.some((e) => e.includes("منفی"))).toBe(true);
  });

  it("قیمت منفی خطا می‌دهد", () => {
    const errors = validateProductInput({ ...valid, sellingPrice: -1 });
    expect(errors.some((e) => e.includes("منفی"))).toBe(true);
  });

  it("قیمت منفی در لیست خطا می‌دهد", () => {
    const errors = validateProductInput({ ...valid, listPrice: -1 });
    expect(errors.some((e) => e.includes("منفی"))).toBe(true);
  });
});

describe("پاک‌سازی متن", () => {
  it("کاراکترهای کنترلی را حذف می‌کند", () => {
    expect(sanitizeText("سلام\u0000دنیا")).toBe("سلام دنیا");
  });

  it("طول را محدود می‌کند", () => {
    expect(sanitizeText("a".repeat(5000), 10)).toHaveLength(10);
  });

  it("مشخصات نامعتبر را فیلتر می‌کند", () => {
    const specs = sanitizeSpecifications([
      { key: "رنگ", value: "مشکی" },
      { key: " " },
      "خارج از ساختار",
      { key: "وزن", value: "۱٫۲ کیلوگرم" },
    ]);
    expect(specs).toEqual([
      { key: "رنگ", value: "مشکی" },
      { key: "وزن", value: "۱٫۲ کیلوگرم" },
    ]);
  });
});

describe("نرمال‌سازی برای تشخیص تکرار", () => {
  it("فضاها و علائم را کنار می‌گذارد", () => {
    expect(normalizeForComparison("  آیفون  ۱۵  ")).toBe(normalizeForComparison("آیفون ۱۵"));
    expect(normalizeForComparison('گوشی "x"')).toBe(normalizeForComparison("گوشیx"));
  });
});