import type { Specification } from "../models/types";
import { TorobProvider } from "./torob/TorobProvider";

/** محصول دریافت‌شده از یک فراهم‌کنندهٔ بیرونی (مستقل از فروشگاه) */
export interface ExternalProduct {
  sourceProvider: string;
  sourceUrl: string;
  sourceId: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  description: string | null;
  price: number | null;
  specifications: Specification[];
}

/**
 * قرارداد فراهم‌کنندهٔ اطلاعات محصول.
 * هر فروشگاه (ترب، دیجی‌کالا، ...) می‌تواند یک پیاده‌سازی ارائه دهد.
 */
export interface ProductProvider {
  readonly id: string;
  readonly name: string;
  /** آیا این فراهم‌کننده می‌تواند لینک داده‌شده را پردازش کند؟ */
  matches(url: string): boolean;
  /** دریافت اطلاعات محصول از لینک */
  getProductFromUrl(url: string): Promise<ExternalProduct>;
}

/** روش دریافت صفحه/اطلاعات برای جلوگیری از وابستگی مستقیم برنامه به جزئیات شبکه */
export interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * ثبت‌نام فراهم‌کننده‌ها. با افزودن فراهم‌کننده‌های جدید (دیجی‌کالا و ...)
 * کافی است این لیست گسترش یابد؛ هستهٔ برنامه تغییر نمی‌کند.
 */
const registry: ProductProvider[] = [new TorobProvider()];

export function getProviderForUrl(url: string): ProductProvider | null {
  const p = registry.find((provider) => provider.matches(url));
  return p ?? null;
}

export function allProviders(): readonly ProductProvider[] {
  return registry;
}