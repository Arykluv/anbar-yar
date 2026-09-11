import type { FetchLike } from "../ProductProvider";
import { AppError, ErrCodes } from "../errors";
import { LOCAL_PROXY_ORIGIN, proxyFetchUrl } from "../LocalProxy";
import { parseTorobHtml } from "./TorobParser";
import type { FetchFailure, TorobUrlInfo } from "./types";
import { parseTorobUrl } from "./url";

export interface TorobFetchOptions {
  /** جایگزینی برای fetch (برای آزمون و پروکسی آینده) */
  fetcher?: FetchLike;
  /** آدرس پایهٔ پروکسی؛ اگر خالی باشد از پروکسی محلی (run.bat) استفاده می‌شود */
  proxyBaseUrl?: string;
}

/** شناسایی خطای fetch و تبدیل آن به یک ساختار قابل فهم */
export function classifyFetchError(err: unknown, response?: Response): FetchFailure {
  // پاسخ CORS: نوع opaque یا فقدان header ها
  if (response) {
    if (response.type === "opaque") {
      return { kind: "cors", message: "درخواست مستقیم توسط مرورگر مسدود شد (محدودیت CORS)." };
    }
    if (response.status === 404) {
      return { kind: "not-found", status: 404, message: "محصول یافت نشد (صفحه ۴۰۴)." };
    }
    if (response.status >= 400) {
      return { kind: "http", status: response.status, message: `پاسخ ناموفق با کد ${response.status}.` };
    }
  }
  if (err instanceof TypeError) {
    // در مرورگر خطای TypeError با پیام Failed to fetch تقریباً همیشه CORS یا قطع شبکه است
    return { kind: "cors", message: "درخواست مستقیم توسط مرورگر مسدود شد (محدودیت CORS)." };
  }
  return { kind: "network", message: "مشکل در برقراری ارتباط با سرور ترب." };
}

const TOROB_PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "fa,en;q=0.8",
};

/**
 * لایهٔ سرویس ترب: اعتبارسنجی لینک، دریافت صفحه، تحلیل و تبدیل.
 * این کلاس مستقیماً در صفحات استفاده نمی‌شود؛ از طریق TorobProvider صدا زده می‌شود.
 */
export class TorobService {
  private readonly fetcher: FetchLike;
  private readonly proxyBaseUrl?: string;

  constructor(options: TorobFetchOptions = {}) {
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.proxyBaseUrl = (options.proxyBaseUrl ?? LOCAL_PROXY_ORIGIN).replace(/\/$/, "") || undefined;
  }

  /** اعتبارسنجی و استخراج شناسه از لینک */
  parseUrl(raw: string): TorobUrlInfo {
    const info = parseTorobUrl(raw);
    if (!info) throw new AppError(ErrCodes.TOROB_URL, "لینک واردشده معتبر نیست. لطفاً لینک محصول ترب را وارد کنید.", { raw });
    return info;
  }

  /**
   * دریافت HTML صفحهٔ محصول.
   * در مرورگر مستقیم، به دلیل CORS این درخواست معمولاً شکست می‌خورد و
   * خطای واضح فارسی با کد عدم دسترسی برمی‌گردد. هیچ دادهٔ جعلی ساخته نمی‌شود.
   */
  async fetchProductPage(url: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: TOROB_PAGE_HEADERS,
        credentials: "omit",
        redirect: "follow",
      });
    } catch (err) {
      const failure = classifyFetchError(err);
      throw new AppError(
        ErrCodes.TOROB_CORS,
        persianMessageForFailure(failure),
        failure,
      );
    }

    if (response.type === "opaque") {
      const failure: FetchFailure = {
        kind: "cors",
        message: "درخواست مستقیم توسط مرورگر مسدود شد (محدودیت CORS).",
      };
      throw new AppError(ErrCodes.TOROB_CORS, persianMessageForFailure(failure), failure);
    }
    if (!response.ok) {
      const proxyMessage = await readProxyError(response);
      if (proxyMessage) {
        const definitive = response.status >= 400 && response.status < 500;
        const failure: FetchFailure = {
          kind: definitive ? "http" : "network",
          status: response.status,
          message: proxyMessage,
        };
        throw new AppError(definitive ? ErrCodes.TOROB_NOT_FOUND : ErrCodes.TOROB_NETWORK, proxyMessage, failure);
      }
      const failure = classifyFetchError(undefined, response);
      throw new AppError(ErrCodes.TOROB_NOT_FOUND, persianMessageForFailure(failure), failure);
    }

    const text = await response.text();
    if (!text || text.trim().length < 100) {
      const failure: FetchFailure = { kind: "network", message: "پاسخ دریافتی خالی بود." };
      throw new AppError(ErrCodes.TOROB_PARSE, persianMessageForFailure(failure), failure);
    }
    return text;
  }

  /** مسیر کامل درخواست: از لینک تا شیء محصول خارجی */
  async getProductFromUrl(raw: string) {
    const info = this.parseUrl(raw);

    // ابتدا پروکسی محلی (اگر بالا باشد)، سپس درخواست مستقیم
    const attempts: string[] = [];
    if (this.proxyBaseUrl) attempts.push(proxyFetchUrl(info.url));
    attempts.push(info.url);

    const failures: string[] = [];
    for (const target of attempts) {
      try {
        const html = await this.fetchProductPage(target);
        const parsed = parseTorobHtml(html);

        if (!parsed.name) {
          throw new AppError(
            ErrCodes.TOROB_PARSE,
            "اطلاعات محصول از صفحهٔ ترب قابل استخراج نبود. صفحه ممکن است ساختار خود را تغییر داده باشد.",
            { url: info.url },
          );
        }

        return { info, parsed };
      } catch (err) {
        const appErr = err instanceof AppError ? err : null;
        // اگر پروکسی پاسخ قطعی از ترب داد (مثل ۴۰۴)، دلیلی برای تلاش مستقیم نیست
        if (target !== info.url && appErr && this.isDefinitiveAnswer(appErr)) throw err;
        failures.push(appErr?.userMessage ?? String(err));
      }
    }

    throw new AppError(
      ErrCodes.TOROB_CORS,
      "دریافت اطلاعات محصول ممکن نشد. مرورگر به‌دلیل محدودیت امنیتی (CORS) اجازهٔ خواندن مستقیم صفحهٔ ترب را نمی‌دهد و پروکسی محلی نیز در دسترس نبود. " +
        "برنامه را با فایل run.bat اجرا کنید تا پروکسی داخلی فعال شود و این قابلیت خودکار کار کند؛ یا محصول را به‌صورت دستی ثبت کنید.",
      { failures },
    );
  }

  /** آیا خطا یک پاسخ قطعی از سوی ترب است؟ (نه مشکل پروکسی/شبکه) */
  private isDefinitiveAnswer(err: AppError): boolean {
    const failure = err.technical as FetchFailure | null | undefined;
    if (!failure) return false;
    if (failure.kind === "not-found") return true;
    if (failure.kind === "http" && typeof failure.status === "number" && failure.status >= 400 && failure.status < 500) {
      return true;
    }
    return false;
  }

  /** پیشنهاد آدرس پروکسی برای نمایش به کاربر */
  suggestProxyHint(): string {
    return "برای دریافت خودکار اطلاعات، برنامه را با فایل run.bat اجرا کنید؛ پروکسی محلی به‌صورت خودکار بالا می‌آید و اتصال به ترب برقرار می‌شود.";
  }
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

function persianMessageForFailure(failure: FetchFailure): string {
  switch (failure.kind) {
    case "cors":
      return (
        "دریافت اطلاعات محصول با مشکل مواجه شد. مرورگر به‌دلیل محدودیت‌های امنیتی (CORS) اجازه‌ی خواندن مستقیم صفحه‌ی ترب را نمی‌دهد. " +
        "برنامه را با run.bat اجرا کنید تا پروکسی محلی فعال شود، یا محصول را به‌صورت دستی ثبت کنید."
      );
    case "not-found":
      return "محصول در ترب یافت نشد. لینک را بررسی کنید.";
    case "http":
      return `ترب درخواست را رد کرد (خطای ${failure.status ?? "نامشخص"}). لینک را بررسی کنید.`;
    default:
      return "دریافت اطلاعات محصول با مشکل مواجه شد. اتصال به اینترنت را بررسی کنید.";
  }
}