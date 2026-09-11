import type { FetchLike } from "../ProductProvider";
import { AppError, ErrCodes } from "../errors";
import { LOCAL_PROXY_ORIGIN } from "../LocalProxy";
import type { LiveExchangeRate, RateFailure } from "./types";

export type { LiveExchangeRate } from "./types";

/**
 * دریافت قیمت لحظه‌ای دلار (تتر) از صرافی نوبیتکس.
 * قیمت بر پایهٔ «بهترین فروش» (bestSell) است و به تومان تبدیل می‌شود.
 * ابتدا از پروکسی محلی (run.bat یا نسخهٔ دسکتاپ) و سپس مستقیم تلاش می‌شود.
 */

const NOBITEX_STATS_URL = "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls";
const CACHE_KEY = "anbar-usd-toman";

export function usdToToman(usd: number, rate: number): number {
  return Math.round(usd * rate);
}

export function tomanToUsd(toman: number, rate: number): number {
  if (!(rate > 0)) return 0;
  return toman / rate;
}

/** آخرین نرخِ ثبت‌شده در دستگاه (برای حالت آفلاین) */
export function readCachedRate(): LiveExchangeRate | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { rate?: unknown; rialPerUsd?: unknown; source?: unknown; updatedAt?: unknown };
    if (typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0) return null;
    const updatedAt = typeof data.updatedAt === "string" ? new Date(data.updatedAt) : null;
    if (!updatedAt || Number.isNaN(updatedAt.getTime())) return null;
    return {
      rate: data.rate,
      rialPerUsd: typeof data.rialPerUsd === "number" ? data.rialPerUsd : Math.round(data.rate * 10),
      source: data.source === "nobitex" ? "nobitex" : "nobitex",
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function cacheRate(rate: LiveExchangeRate): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ rate: rate.rate, rialPerUsd: rate.rialPerUsd, source: rate.source, updatedAt: rate.updatedAt.toISOString() }),
    );
  } catch {
    /* حافظهٔ محلی در دسترس نیست؛ نرخ این‌بار کش نمی‌شود */
  }
}

function classifyStatus(status: number): string {
  if (status >= 500) return "صرافی در حال حاضر پاسخ نمی‌دهد؛ کمی بعد دوباره تلاش کنید.";
  return `درخواست با خطای ${status} رد شد.`;
}

/** استخراج نرخ از پاسخ JSON نوبیتکس */
export function parseNobitexStats(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as { status?: unknown; stats?: Record<string, unknown> };
  if (rec.status !== "ok") return null;
  const stat = rec.stats?.["usdt-rls"];
  if (!stat || typeof stat !== "object") return null;
  const s = stat as { bestSell?: unknown };
  const bestSell = typeof s.bestSell === "string" ? Number(s.bestSell) : s.bestSell;
  if (typeof bestSell !== "number" || !Number.isFinite(bestSell) || bestSell <= 0) return null;
  const rial = Math.round(bestSell);
  if (rial <= 0) return null;
  return Math.round(rial / 10);
}

async function fetchStats(fetcher: FetchLike, target: string): Promise<LiveExchangeRate> {
  let response: Response;
  try {
    response = await fetcher(target, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "follow",
    });
  } catch (err) {
    const failure: RateFailure = {
      kind: err instanceof TypeError ? "network" : "network",
      message: "برقراری ارتباط با صرافی ممکن نشد.",
    };
    throw new AppError(ErrCodes.RATE_UNAVAILABLE, failure.message, failure);
  }

  if (response.type === "opaque") {
    const failure: RateFailure = { kind: "network", message: "دسترسی به صرافی توسط مرورگر مسدود شد." };
    throw new AppError(ErrCodes.RATE_UNAVAILABLE, failure.message, failure);
  }

  if (!response.ok) {
    const proxyMessage = await readProxyError(response);
    const failure: RateFailure = { kind: "http", status: response.status, message: proxyMessage ?? classifyStatus(response.status) };
    throw new AppError(ErrCodes.RATE_UNAVAILABLE, failure.message, failure);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    const failure: RateFailure = { kind: "parse", message: "پاسخ صرافی قابل خواندن نبود." };
    throw new AppError(ErrCodes.RATE_UNAVAILABLE, failure.message, failure);
  }

  const toman = parseNobitexStats(json);
  if (toman === null) {
    const failure: RateFailure = { kind: "parse", message: "قیمت لحظه‌ای دلار از صرافی دریافت نشد." };
    throw new AppError(ErrCodes.RATE_UNAVAILABLE, failure.message, failure);
  }

  return { rate: toman, rialPerUsd: toman * 10, source: "nobitex", updatedAt: new Date() };
}

/** خواندن خطای JSON از پاسخ پروکسی محلی (مثل { error: "..." }) */
async function readProxyError(response: Response): Promise<string | null> {
  if (response.status === 204 || response.status === 304) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const data = (await response.clone().json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
  } catch {
    /* پاسخ JSON نامعتبر؛ نادیده گرفته می‌شود */
  }
  return null;
}

export interface ExchangeRateOptions {
  fetcher?: FetchLike;
  proxyBaseUrl?: string;
}

/** دریافت نرخ لحظه‌ای؛ ابتدا پروکسی محلی، سپس درخواست مستقیم */
export async function fetchLiveRate(options: ExchangeRateOptions = {}): Promise<LiveExchangeRate> {
  const fetcher = options.fetcher ?? ((...args) => fetch(...args));
  const base = (options.proxyBaseUrl ?? LOCAL_PROXY_ORIGIN).replace(/\/$/, "") || undefined;

  const attempts: string[] = [];
  if (base) attempts.push(`${base}/fetch?url=${encodeURIComponent(NOBITEX_STATS_URL)}`);
  attempts.push(NOBITEX_STATS_URL);

  const failures: string[] = [];
  for (const target of attempts) {
    try {
      const rate = await fetchStats(fetcher, target);
      cacheRate(rate);
      return rate;
    } catch (err) {
      if (err instanceof AppError) {
        failures.push(err.userMessage);
        const failure = err.technical as RateFailure | null | undefined;
        const proxyOnly = target.startsWith("http://127.0.0.1");
        const definitive = proxyOnly && failure && failure.kind === "http" && typeof failure.status === "number" && failure.status < 500;
        if (definitive) throw err;
        continue;
      }
      failures.push(String(err));
    }
  }

  throw new AppError(
    ErrCodes.RATE_UNAVAILABLE,
    "دریافت قیمت لحظه‌ای دلار ممکن نشد. اتصال به اینترنت را بررسی کنید؛ یا اگر نسخهٔ Portable/راه‌انداز را اجرا کرده‌اید مطمئن شوید اینترنت (و در صورت نیاز VPN) وصل است.",
    { failures },
  );
}