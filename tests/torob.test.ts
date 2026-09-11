import { describe, expect, it } from "vitest";
import { parseTorobHtml, priceFromText } from "../src/services/torob/TorobParser";
import { parseTorobUrl, isValidTorobUrl } from "../src/services/torob/url";
import { TorobService, classifyFetchError } from "../src/services/torob/TorobService";
import { AppError } from "../src/services/errors";
import { getProviderForUrl } from "../src/services/ProductProvider";

describe("اعتبارسنجی لینک ترب", () => {
  it("لینک معتبر ترب را می‌پذیرد", () => {
    const info = parseTorobUrl("https://torob.com/p/5f0d3abc/%DA%AF%D9%88%D8%B4%DB%8C/");
    expect(info?.productId).toBe("5f0d3abc");
    expect(info?.url).toBe("https://torob.com/p/5f0d3abc/");
  });

  it("لینک معتبر بدون اسلاگ را می‌پذیرد", () => {
    const info = parseTorobUrl("https://torob.com/p/abc123/");
    expect(info?.productId).toBe("abc123");
  });

  it("شناسهٔ UUID دار با خط تیره را می‌پذیرد", () => {
    const info = parseTorobUrl(
      "https://torob.com/p/e0babce0-3d7f-4e57-9248-a8fddd2c59cb/%D8%AF%D9%88%D8%B1%D8%A8%DB%8C%D9%86/",
    );
    expect(info?.productId).toBe("e0babce0-3d7f-4e57-9248-a8fddd2c59cb");
    expect(info?.url).toBe("https://torob.com/p/e0babce0-3d7f-4e57-9248-a8fddd2c59cb/");
    expect(isValidTorobUrl("https://torob.com/p/e0babce0-3d7f-4e57-9248-a8fddd2c59cb/")).toBe(true);
  });

  it("آدرس غیر مرتبط را رد می‌کند", () => {
    expect(isValidTorobUrl("https://google.com/p/abc123/")).toBe(false);
    expect(isValidTorobUrl("https://torob.com/search/xyz")).toBe(false);
    expect(isValidTorobUrl("not a url")).toBe(false);
    expect(isValidTorobUrl("")).toBe(false);
    expect(isValidTorobUrl("https://torob.com/b/1234/")).toBe(false);
  });

  it("فراهم‌کنندهٔ مناسب را برمی‌گرداند", () => {
    expect(getProviderForUrl("https://torob.com/p/abc123/")?.id).toBe("torob");
    expect(getProviderForUrl("https://digikala.com/product/123")).toBeNull();
  });
});

describe("استخراج قیمت از متن", () => {
  it("ارقام و واحدهای فارسی را می‌فهمد", () => {
    expect(priceFromText("۲۳۴٬۵۶۷ تومان")).toBe(234567);
    expect(priceFromText("1,250,000 ریال")).toBe(1250000);
  });

  it("متن بدون قیمت null برمی‌گرداند", () => {
    expect(priceFromText("ناموجود")).toBeNull();
  });
});

describe("تحلیل HTML محصول ترب", () => {
  const sampleHtml = `
<!doctype html>
<html lang="fa">
<head>
  <title>گوشی سامسونگ A54 — ترب</title>
  <meta property="og:title" content="گوشی سامسونگ A54" />
  <meta property="og:image" content="https://cdn.torob.com/photo.jpg" />
  <meta property="og:description" content="گوشی هوشمند با صفحه‌نمایش ۶٫۴ اینچ." />
  <meta property="product:brand" content="سامسونگ" />
  <meta property="product:category" content="موبایل" />
  <meta property="product:price:amount" content="17,500,000" />
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"گوشی سامسونگ A54",
   "image":"https://cdn.torob.com/photo.jpg","brand":{"name":"سامسونگ"},
   "offers":{"@type":"Offer","price":"17500000","priceCurrency":"IRR"}}
  </script>
</head>
<body>
  <h1>گوشی سامسونگ A54</h1>
  <table>
    <tr><td>حافظه</td><td>۲۵۶ گیگابایت</td></tr>
    <tr><td>رنگ</td><td>مشکی</td></tr>
  </table>
</body>
</html>`;

  it("نام، برند، دسته، تصویر و قیمت را استخراج می‌کند", () => {
    const parsed = parseTorobHtml(sampleHtml);
    expect(parsed.name).toBe("گوشی سامسونگ A54");
    expect(parsed.brand).toBe("سامسونگ");
    expect(parsed.category).toBe("موبایل");
    expect(parsed.imageUrl).toContain("cdn.torob.com");
    expect(parsed.price).toBe(17500000);
    expect(parsed.confidence).toBeGreaterThan(0);
  });

  it("مشخصات را از جدول استخراج می‌کند", () => {
    const parsed = parseTorobHtml(sampleHtml);
    expect(parsed.specifications.some((s) => s.key === "رنگ" && s.value === "مشکی")).toBe(true);
  });

  it("برای HTML خالی چیزی نمی‌سازد و confidence صفر دارد", () => {
    const parsed = parseTorobHtml("<html><body><p>سلام</p></body></html>");
    expect(parsed.name).toBe("");
    expect(parsed.price).toBeNull();
    expect(parsed.confidence).toBe(0);
  });

  it("داده‌های __NEXT_DATA__ را نیز متوجه می‌شود", () => {
    const html = `<html><head><script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"baseProduct":{"name1":"هدفون شیائومی","price":950000,"price_text":"۹۵۰٬۰۰۰","brand":"شیائومی","image_url":"https://i.imgur.com/x.png"}}}}
    </script></head><body></body></html>`;
    const parsed = parseTorobHtml(html);
    expect(parsed.name).toBe("هدفون شیائومی");
    expect(parsed.price).toBe(950000);
  });

  it("نام اصلی را به‌جای نام‌های ناخواستهٔ داخل صفحه انتخاب می‌کند", () => {
    const html = `<html><head><script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"chatbotEntry":{"name":"اسنپ‌پی"},"baseProduct":{"name1":"کره جغرافیایی سایز ۳۰ پایه فلزی نسیم","price_text":"۸۵۰٬۰۰۰"}}}}
    </script></head><body></body></html>`;
    const parsed = parseTorobHtml(html);
    expect(parsed.name).toBe("کره جغرافیایی سایز ۳۰ پایه فلزی نسیم");
  });

  it("مشخصات ساخت‌یافته، دسته و قیمت تومانی را از برداشت واقعی ترب استخراج می‌کند", () => {
    const html = `<html><head><script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"baseProduct":{
        "name1":"کره جغرافیایی سایز ۳۰ پایه فلزی نسیم",
        "price_text":"۸۵۰٬۰۰۰",
        "torob_category":"لوازم تحریر",
        "breadcrumbs":[{"id":170,"title":"فرهنگی هنری"},{"id":110,"title":"لوازم تحریر"},{"id":4056,"title":"کره جغرافیایی"}],
        "structural_specs":{"headers":[{"header":"مشخصات کلی","specs":{"جنس":"فلز","سایز":"۳۰"}}]}
      }}}}
    </script></head><body></body></html>`;
    const parsed = parseTorobHtml(html);
    expect(parsed.name).toBe("کره جغرافیایی سایز ۳۰ پایه فلزی نسیم");
    expect(parsed.price).toBe(850000);
    expect(parsed.category).toBe("لوازم تحریر");
    expect(parsed.specifications.some((s) => s.key === "جنس" && s.value === "فلز")).toBe(true);
    expect(parsed.confidence).toBeGreaterThan(0);
  });
});

describe("سرویس ترب", () => {
  it("localParseUrl برای لینک نامعتبر خطای فارسی می‌دهد", () => {
    const service = new TorobService({});
    expect(() => service.parseUrl("https://example.com")).toThrow(AppError);
  });

  it("خطای CORS مرورگر را شفاف می‌سازد", () => {
    const failure = classifyFetchError(new TypeError("Failed to fetch"));
    expect(failure.kind).toBe("cors");
  });

  it("پاسخ opaque را خطای CORS تشخیص می‌دهد", () => {
    const opaque = { type: "opaque" } as Response;
    const failure = classifyFetchError(undefined, opaque);
    expect(failure.kind).toBe("cors");
  });

  it("کد ۴۰۴ را «پیدا نشد» تشخیص می‌دهد", () => {
    const response = { type: "basic", status: 404, statusText: "Not Found", ok: false } as Response;
    const failure = classifyFetchError(undefined, response);
    expect(failure.kind).toBe("not-found");
  });

  it("در صورت دسترسی به HTML، اطلاعات کامل برمی‌گرداند", async () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="محصول تست" />
      <meta property="og:image" content="https://cdn.test/img.jpg" />
    </head><body><h1>محصول تست</h1></body></html>`;
    const fetcher = async () => new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    const service = new TorobService({ fetcher });
    const result = await service.getProductFromUrl("https://torob.com/p/xyz123/");
    expect(result.info.productId).toBe("xyz123");
    expect(result.parsed.name).toBe("محصول تست");
  });

  it("اگر صفحه در دسترس نباشد (CORS) صادقانه خطا می‌دهد", async () => {
    const fetcher = async () => {
      throw new TypeError("Failed to fetch");
    };
    const service = new TorobService({ fetcher });
    await expect(service.getProductFromUrl("https://torob.com/p/xyz123/")).rejects.toThrow(/CORS|محدودیت/);
  });

  it("اگر پروکسی محلی روشن نباشد، به درخواست مستقیم سقوط می‌کند", async () => {
    let directCalls = 0;
    const fetcher = async (url: RequestInfo | URL) => {
      if (String(url).includes("127.0.0.1:4170")) throw new TypeError("Failed to fetch");
      directCalls += 1;
      return new Response('<html><head><meta property="og:title" content="محصول مستقیم" /></head><body><h1>محصول مستقیم</h1></body></html>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };
    const service = new TorobService({ fetcher });
    const result = await service.getProductFromUrl("https://torob.com/p/xyz123/");
    expect(directCalls).toBe(1);
    expect(result.parsed.name).toBe("محصول مستقیم");
  });

  it("پاسخ قطعی ۴۰۴ از پروکسی را بدون تلاش مستقیم گزارش می‌کند", async () => {
    let directCalls = 0;
    const fetcher = async () => {
      directCalls += 1;
      return new Response("<html>Not found</html>", { status: 404 });
    };
    const service = new TorobService({ fetcher });
    await expect(service.getProductFromUrl("https://torob.com/p/xyz123/")).rejects.toThrow(/یافت نشد/);
    expect(directCalls).toBe(1);
  });
});