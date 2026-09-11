export type RouteName = "dashboard" | "products" | "add" | "product" | "sale" | "settings" | "not-found";

export interface Route {
  name: RouteName;
  /** شناسهٔ محصول (در صورت وجود) */
  id: number | null;
  /** پارامترهای جستجو در مسیر */
  query: URLSearchParams;
}

/** نمایش URL کاربرپسند برای دسته‌بندی ها */
export function routeToHash(route: string, query?: Record<string, string>): string {
  const q = query ? new URLSearchParams(query).toString() : "";
  return route + (q ? `?${q}` : "");
}

function parseHash(hash: string): Route {
  const withoutHash = hash.replace(/^#/, "").trim();
  const [pathPart, queryPart] = withoutHash.split("?");
  const query = new URLSearchParams(queryPart ?? "");
  const segments = (pathPart ?? "").split("/").filter(Boolean);

  if (segments.length === 0) return { name: "dashboard", id: null, query };
  switch (segments[0]) {
    case "dashboard":
      return { name: "dashboard", id: null, query };
    case "products":
      return { name: "products", id: null, query };
    case "add":
      return { name: "add", id: null, query };
    case "sale":
      return { name: "sale", id: null, query };
    case "product": {
      const id = Number(segments[1]);
      return { name: "product", id: Number.isInteger(id) && id > 0 ? id : null, query };
    }
    case "settings":
      return { name: "settings", id: null, query };
    default:
      return { name: "not-found", id: null, query };
  }
}

export function currentRoute(): Route {
  return parseHash(window.location.hash || "#/");
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

/** بازگشت به لیست محصولات با حفظ فیلترها */
export function backToProducts(): void {
  navigate("#/products");
}