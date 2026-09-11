import { describe, expect, it } from "vitest";
import {
  fetchLiveRate,
  parseNobitexStats,
  tomanToUsd,
  usdToToman,
  readCachedRate,
} from "../src/services/currency/ExchangeRateService";
import type { FetchLike } from "../src/services/ProductProvider";
import { AppError } from "../src/services/errors";

function statsResponse(bestSell: number): Response {
  return new Response(
    JSON.stringify({
      status: "ok",
      stats: { "usdt-rls": { bestSell: String(bestSell) } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("parseNobitexStats", () => {
  it("قیمت ریال را به تومان تبدیل می‌کند", () => {
    expect(parseNobitexStats({ status: "ok", stats: { "usdt-rls": { bestSell: "8540000" } } })).toBe(854000);
  });

  it("رشتهٔ اعشاری را گرد می‌کند", () => {
    expect(parseNobitexStats({ status: "ok", stats: { "usdt-rls": { bestSell: "8541235.6" } } })).toBe(854124);
  });

  it("status غیر از ok را رد می‌کند", () => {
    expect(parseNobitexStats({ status: "error", stats: {} })).toBeNull();
  });

  it("نبودن آمار usdt-rls را null می‌کند", () => {
    expect(parseNobitexStats({ status: "ok", stats: {} })).toBeNull();
  });

  it("قیمت نامعتبر/صفر را null می‌کند", () => {
    expect(parseNobitexStats({ status: "ok", stats: { "usdt-rls": { bestSell: "0" } } })).toBeNull();
    expect(parseNobitexStats({ status: "ok", stats: { "usdt-rls": {} } })).toBeNull();
  });
});

describe("تبدیل دلار به تومان", () => {
  it("تومان را بر اساس نرخ محاسبه می‌کند", () => {
    expect(usdToToman(10, 85400)).toBe(854000);
    expect(usdToToman(1.5, 85400)).toBe(128100);
  });

  it("دلار را بر اساس نرخ محاسبه می‌کند", () => {
    expect(tomanToUsd(854000, 85400)).toBe(10);
  });

  it("نرخ نامعتبر صفر برمی‌گرداند", () => {
    expect(tomanToUsd(100, 0)).toBe(0);
  });
});

describe("fetchLiveRate", () => {
  it("از پروکسی محلی (آدرس ۱۲۷.۰.۰.۱) نرخ را دریافت و ذخیره می‌کند", async () => {
    const fetcher: FetchLike = async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.includes("127.0.0.1")) return statsResponse(8540000);
      throw new TypeError("should not reach direct");
    };
    const rate = await fetchLiveRate({ fetcher, proxyBaseUrl: "http://127.0.0.1:4170" });
    expect(rate.rate).toBe(854000);
    expect(rate.source).toBe("nobitex");
    expect(Math.round(rate.rialPerUsd)).toBe(8540000);
  });

  it("وقتی پروکسی فعال نیست، مستقیم تلاش می‌کند", async () => {
    const fetcher: FetchLike = async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.includes("127.0.0.1")) throw new TypeError("proxy down");
      return statsResponse(9000000);
    };
    const rate = await fetchLiveRate({ fetcher, proxyBaseUrl: "http://127.0.0.1:4170" });
    expect(rate.rate).toBe(900000);
  });

  it("خطای قطعی پروکسی را بدون تلاش مستقیم برمی‌گرداند", async () => {
    let directCalls = 0;
    const fetcher: FetchLike = async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.includes("127.0.0.1")) {
        return new Response(JSON.stringify({ error: "فقط آدرس‌های مجاز پشتیبانی می‌شوند." }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      directCalls++;
      return statsResponse(1000000);
    };
    await expect(fetchLiveRate({ fetcher, proxyBaseUrl: "http://127.0.0.1:4170" })).rejects.toBeInstanceOf(AppError);
    expect(directCalls).toBe(0);
  });

  it("شکست هر دو مسیر را خطای کاربرپسند می‌سازد", async () => {
    const fetcher: FetchLike = async () => {
      throw new TypeError("network");
    };
    await expect(fetchLiveRate({ fetcher, proxyBaseUrl: "http://127.0.0.1:4170" })).rejects.toMatchObject({
      code: "rate-unavailable",
    });
  });

  it("بدون پروکسی (فقط مستقیم) هم کار می‌کند", async () => {
    const fetcher: FetchLike = async () => statsResponse(7500000);
    const rate = await fetchLiveRate({ fetcher, proxyBaseUrl: "" });
    expect(rate.rate).toBe(750000);
  });
});

describe("کش نرخ", () => {
  it("وقتی چیزی ذخیره نشده باشد null برمی‌گرداند", () => {
    expect(readCachedRate()).toBeNull();
  });
});