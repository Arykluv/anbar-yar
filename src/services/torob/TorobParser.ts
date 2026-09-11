import { sanitizeSpecifications, sanitizeText, sanitizeLongText, normalizeForComparison, LIMITS } from "../../models/product";
import type { Specification } from "../../models/types";
import type { TorobParsedProduct } from "./types";

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function getTagContent(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(stripTags(match[1] ?? "")).trim() : "";
}

function getMetaAttribute(html: string, attrValue: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]*\\s(?:property|name)\\s*=\\s*["']${escapeRegExp(attrValue)}["'][^>]*>`,
    "i",
  );
  const match = html.match(pattern);
  if (!match) return null;
  const content = match[0].match(/\scontent\s*=\s*("([^"]*)"|'([^']*)')/i);
  const value = content ? (content[2] ?? content[3] ?? "") : "";
  return decodeEntities(value).trim() || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** استخراج همهٔ اسکریپت‌های JSON-LD */
function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = [];
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    try {
      results.push(JSON.parse(raw));
    } catch {
      /* JSON نامعتبر؛ نادیده گرفته می‌شود */
    }
  }
  return results;
}

/** JSON داخل <script id="__NEXT_DATA__"> */
function extractNextData(html: string): unknown {
  const match = html.match(/<script[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const raw = (match[1] ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Rec;
  return null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstNonEmpty(values: Array<string | null | undefined>): string {
  for (const v of values) {
    const s = str(v);
    if (s) return s;
  }
  return "";
}

/** تبدیل رشتهٔ حاوی قیمت (با ارقام فارسی و جداساز) به عدد */
export function priceFromText(text: string): number | null {
  if (!text) return null;
  const normalized = text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٬,\s]/g, "");
  const match = normalized.match(/(-?\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return priceFromText(value);
  return null;
}

/** جستجوی بازگشتی (با محافظت از حلقه) برای یافتن یک کلید؛ فقط در ساختارهای معتبر */
function deepFindField(node: unknown, keys: readonly string[], visited: Set<object>): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (visited.has(node)) return undefined;
  visited.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindField(item, keys, visited);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = node as Rec;
  for (const key of keys) {
    const val = record[key];
    if (val !== undefined && val !== null && val !== "" && (typeof val === "string" || typeof val === "number")) {
      return val;
    }
  }
  for (const key of Object.keys(record)) {
    const found = deepFindField(record[key], keys, visited);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** یافتن یک فیلد ساده (رشته یا {name}) از JSON-LD نوع Product */
function jsonLdField(jsonLd: unknown[], key: string): string | null {
  for (const block of jsonLd) {
    const rec = asRecord(block);
    if (!rec) continue;
    const type = str(rec["@type"]);
    if (type !== "Product" && !type.includes("Product")) continue;
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    const valueRec = asRecord(value);
    const name = str(valueRec?.name);
    if (name) return name;
    break;
  }
  return null;
}

/** یافتن قیمت پیشنهادی از JSON-LD (بر اساس lowPrice/highPrice — واحد: ریال) */
function jsonLdOfferPrice(jsonLd: unknown[]): number | null {
  for (const block of jsonLd) {
    const rec = asRecord(block);
    if (!rec) continue;
    const type = str(rec["@type"]);
    if (type !== "Product" && !type.includes("Product")) continue;
    const offers = asRecord(rec.offers);
    if (!offers) return null;
    const low = numberFromUnknown(offers.lowPrice);
    const high = numberFromUnknown(offers.highPrice);
    const price = numberFromUnknown(offers.price);
    const best = [low, high, price].filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b)[0];
    return best ?? null;
  }
  return null;
}

/** استخراج مشخصات از ساختار نوین ترب (structural_specs / key_specs) */
function extractStructuredSpecs(base: Rec | null): Specification[] {
  const out: Specification[] = [];
  if (!base) return out;

  const structural = asRecord(base.structural_specs);
  const headers = structural?.headers;
  if (Array.isArray(headers)) {
    for (const header of headers) {
      const headerRec = asRecord(header);
      const specs = asRecord(headerRec?.specs);
      if (!specs) continue;
      for (const [key, value] of Object.entries(specs)) {
        const k = sanitizeText(key, 200);
        const v = sanitizeLongText(typeof value === "string" ? value : JSON.stringify(value), LIMITS.TEXT_MAX_LENGTH);
        if (k && v) out.push({ key: k, value: v });
      }
    }
  }

  const keySpecs = base.key_specs;
  if (Array.isArray(keySpecs)) {
    for (const item of keySpecs) {
      if (Array.isArray(item) && item.length >= 2 && typeof item[0] === "string") {
        out.push({ key: sanitizeText(item[0]), value: sanitizeLongText(String(item[1]), LIMITS.TEXT_MAX_LENGTH) });
      } else {
        const rec = asRecord(item);
        if (rec) {
          const k = sanitizeText(str(rec.key ?? rec.title));
          const v = sanitizeLongText(str(rec.value ?? rec.text), LIMITS.TEXT_MAX_LENGTH);
          if (k && v) out.push({ key: k, value: v });
        }
      }
    }
  }

  return sanitizeSpecifications(out);
}

/** یافتن نام برند از درون مشخصات (کلیدهایی مانند «برند») */
function brandFromSpecs(specs: Specification[]): string | null {
  for (const spec of specs) {
    const norm = normalizeForComparison(spec.key);
    if (norm === "برند" || norm.includes("برند")) return spec.value;
  }
  return null;
}

/** استخراج دسته از breadcrumbs (برگ = دستهٔ نهایی) یا torob_category */
function categoryFromBase(base: Rec | null): string | null {
  if (!base) return null;
  const cat = str(base.torob_category);
  if (cat) return cat;
  const rec = asRecord(base.torob_category);
  const catName = str(rec?.name ?? rec?.title);
  if (catName) return catName;
  const crumbs = base.breadcrumbs;
  if (Array.isArray(crumbs) && crumbs.length > 0) {
    for (let i = crumbs.length - 1; i >= 0; i--) {
      const crumb = asRecord(crumbs[i]);
      const title = str(crumb?.title);
      if (title && Number(crumb?.id ?? 0) > 0 && title !== "خانه" && title !== "دسته‌بندی") return title;
    }
  }
  return null;
}

/** نام برند از baseProduct؛ می‌تواند رشته یا شیء {name} باشد */
function brandFromBase(base: Rec | null): string | null {
  if (!base) return null;
  const direct = str(base.brand);
  if (direct) return direct;
  const rec = asRecord(base.brand);
  const name = str(rec?.name);
  return name || null;
}

/**
 * تحلیل HTML صفحهٔ محصول ترب و استخراج اطلاعات.
 * اولویت با دادهٔ ساخت‌یافتهٔ __NEXT_DATA__ (baseProduct) و سپس JSON-LD است؛
 * این تابع فقط «پیش‌نمایش» تولید می‌کند؛ کاربر قبل از ذخیره، همه چیز را تأیید می‌کند.
 * اگر چیزی معتبر پیدا نشود، confidence پایین برمی‌گردد؛ هیچ اطلاعات جعلی ساخته نمی‌شود.
 */
export function parseTorobHtml(html: string): TorobParsedProduct {
  const nextData = extractNextData(html);
  const jsonLd = extractJsonLd(html);

  const nextRec = asRecord(nextData);
  const nextProps = asRecord(nextRec?.props);
  const pageProps = asRecord(nextProps?.pageProps);
  const base = asRecord(pageProps?.baseProduct);

  // ---------- نام ----------
  const specs = extractStructuredSpecs(base);
  const name =
    sanitizeText(
      firstNonEmpty([
        str(base?.name1),
        jsonLdField(jsonLd, "name"),
        getMetaAttribute(html, "og:title"),
        getMetaAttribute(html, "twitter:title"),
        getTagContent(html, "h1"),
        str(base?.slug_name).replace(/[-_]+/g, " "),
      ]),
      200,
    );

  // ---------- تصویر ----------
  const imageUrl =
    firstNonEmpty([
      str(base?.image_url),
      (() => {
        const urls = base?.image_urls;
        if (Array.isArray(urls)) {
          for (const u of urls) {
            const s = str(u);
            if (s) return s;
          }
        }
        return "";
      })(),
      jsonLdField(jsonLd, "image"),
      getMetaAttribute(html, "og:image"),
    ]) || null;

  // ---------- برند ----------
  const brand =
    sanitizeText(
      firstNonEmpty([
        brandFromBase(base),
        jsonLdField(jsonLd, "brand"),
        brandFromSpecs(specs),
        getMetaAttribute(html, "product:brand"),
        getMetaAttribute(html, "og:brand"),
      ]),
      100,
    ) || null;

  // ---------- دسته‌بندی ----------
  const category =
    sanitizeText(
      firstNonEmpty([
        categoryFromBase(base),
        str(deepFindField(jsonLd, ["category"], new Set<object>())),
        getMetaAttribute(html, "product:category"),
      ]),
      100,
    ) || null;

  // ---------- توضیحات ----------
  const description =
    sanitizeText(
      firstNonEmpty([
        str(deepFindField(jsonLd, ["description"], new Set<object>())),
        getMetaAttribute(html, "og:description"),
        getMetaAttribute(html, "description"),
      ]),
      3000,
    ) || null;

  // ---------- قیمت ----------
  let price: number | null = null;
  let priceText: string | null = null;

  const priceTextFromBase = str(base?.price_text);
  if (priceTextFromBase) {
    const parsed = priceFromText(priceTextFromBase);
    if (parsed !== null && parsed > 0) {
      price = parsed;
      priceText = priceTextFromBase;
    }
  }
  if (price === null) {
    const basePrice = numberFromUnknown(base?.price);
    if (basePrice !== null && basePrice > 0) price = basePrice;
  }
  if (price === null) {
    const metaPrice = [getMetaAttribute(html, "product:price:amount"), getMetaAttribute(html, "product:price")]
      .map((v) => numberFromUnknown(v))
      .find((v): v is number => v !== null && v > 0);
    if (metaPrice) price = metaPrice;
  }
  if (price === null) {
    const rialPrice = jsonLdOfferPrice(jsonLd);
    // قیمت JSON-LD ترب به ریال است؛ برای نمایش به تومان تبدیل می‌شود
    if (rialPrice !== null && rialPrice > 0) price = Math.round(rialPrice / 10);
  }

  // ---------- مشخصات ----------
  let specifications = specs;
  if (specifications.length === 0) {
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
    const tableSpecs: Specification[] = [];
    for (const row of rows) {
      const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [];
      const texts = cells.map((c) => stripTags(c.replace(/<t[dh][^>]*>/gi, " ")).trim());
      const idx = texts.findIndex((t) => t.length > 0);
      if (idx >= 0 && idx + 1 < texts.length && texts[idx + 1]) {
        tableSpecs.push({ key: texts[idx] ?? "", value: texts[idx + 1] ?? "" });
      }
    }
    specifications = sanitizeSpecifications(tableSpecs);
  }

  // ---------- امتیاز اطمینان ----------
  let confidence = 0;
  if (name) confidence += 2;
  if (imageUrl) confidence += 1;
  if (price !== null) confidence += 2;
  if (brand) confidence += 1;
  if (specifications.length > 0) confidence += 1;

  return {
    name,
    brand,
    category,
    imageUrl: imageUrl ? sanitizeText(imageUrl, 2000) : null,
    description,
    price,
    priceText: priceText ? sanitizeText(priceText, 100) : null,
    specifications,
    confidence,
  };
}