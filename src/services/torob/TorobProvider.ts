import type { ExternalProduct, ProductProvider } from "../ProductProvider";
import { AppError, ErrCodes } from "../errors";
import { TorobService } from "./TorobService";
import { sanitizeSpecifications } from "../../models/product";
import { TOROB_HOST, isValidTorobUrl } from "./url";

/**
 * فراهم‌کنندهٔ ترب که قرارداد ProductProvider را پیاده‌سازی می‌کند.
 * برنامهٔ اصلی فقط با ProductProvider کار می‌کند و هیچ وابستگی مستقیم به ترب ندارد.
 */
export class TorobProvider implements ProductProvider {
  readonly id = "torob";
  readonly name = "ترب";
  readonly service = new TorobService();

  /** آیا لینک به ترب اشاره دارد؟ */
  matches(url: string): boolean {
    return isValidTorobUrl(url) && url.includes(TOROB_HOST);
  }

  /** دریافت محصول از لینک ترب */
  async getProductFromUrl(url: string): Promise<ExternalProduct> {
    const { info, parsed } = await this.service.getProductFromUrl(url);

    if (parsed.confidence === 0 && !parsed.name) {
      throw new AppError(
        ErrCodes.TOROB_PARSE,
        "اطلاعات محصول از صفحهٔ ترب قابل استخراج نبود. لطفاً بعداً دوباره تلاش کنید یا محصول را دستی ثبت کنید.",
        parsed,
      );
    }

    return {
      sourceProvider: this.id,
      sourceUrl: info.url,
      sourceId: info.productId,
      name: parsed.name,
      brand: parsed.brand,
      category: parsed.category,
      imageUrl: parsed.imageUrl,
      description: parsed.description,
      price: parsed.price,
      specifications: sanitizeSpecifications(parsed.specifications),
    };
  }
}