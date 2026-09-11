import { describe, expect, it } from "vitest";
import {
  backupFileName,
  formatJalali,
  formatNumber,
  formatPrice,
  toFaDigits,
  toJalali,
} from "../src/utils/format";

describe("قالب‌بندی اعداد فارسی", () => {
  it("ارقام را به فارسی تبدیل می‌کند", () => {
    expect(toFaDigits(1234567890)).toBe("۱۲۳۴۵۶۷۸۹۰");
    expect(toFaDigits("2024")).toBe("۲۰۲۴");
  });

  it("جداکننده هزارگان را اضافه می‌کند", () => {
    expect(formatNumber(1234567)).toBe("1٬234٬567");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1234.5)).toBe("1٬234.50");
  });

  it("قیمت را با واحد تومان نمایش می‌دهد", () => {
    expect(formatPrice(250000)).toBe("۲۵۰٬۰۰۰ تومان");
    expect(formatPrice(null)).toBe("—");
  });
});

describe("تاریخ جلالی", () => {
  it("یک تاریخ میلادی مشخص را به جلالی تبدیل می‌کند", () => {
    // ۲۰ مارس ۲۰۲۴ برابر با ۱ فروردین ۱۴۰۳
    const j = toJalali(new Date(2024, 2, 20));
    expect(j).toEqual({ year: 1403, month: 1, day: 1 });
  });

  it("فرمت جلالی با ارقام فارسی تولید می‌کند", () => {
    expect(formatJalali(new Date(2026, 8, 4))).toBe("۱۴۰۵/۰۶/۱۳");
  });

  it("نام فایل پشتیبان با تاریخ جلالی ساخته می‌شود", () => {
    expect(backupFileName(new Date(2026, 8, 4))).toBe("inventory-backup-1405-06-13.json");
  });
});