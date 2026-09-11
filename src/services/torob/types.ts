import type { Specification } from "../../models/types";

/** اطلاعات استخراج‌شده از لینک ترب قبل از درخواست شبکه */
export interface TorobUrlInfo {
  /** آدرس نرمال‌شده محصول */
  url: string;
  /** شناسهٔ یکتای محصول در ترب */
  productId: string;
  /** نام کوتاه از لینک (اختیاری) */
  slug?: string;
}

/** اطلاعات صفحهٔ خام ترب (نتیجهٔ تحلیل HTML) */
export interface TorobParsedProduct {
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  description: string | null;
  price: number | null;
  priceText: string | null;
  specifications: Specification[];
  /** تعداد فیلدهای استخراج‌شده؛ صفر یعنی چیزی پیدا نشد */
  confidence: number;
}

export type FetchFailureKind = "cors" | "network" | "http" | "not-found";

export interface FetchFailure {
  kind: FetchFailureKind;
  status?: number;
  message: string;
}