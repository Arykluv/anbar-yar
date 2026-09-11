import { clear, h, input, select } from "../app/dom";
import type { PageCleanup } from "../app/App";
import type { Route } from "../app/router";
import { navigate } from "../app/router";
import { onDataChanged } from "../app/events";
import { ProductCard } from "../components/ProductCard";
import { productRepository, filterProducts, type ProductFilter, type SortKey } from "../db/ProductRepository";
import { pageHeader, emptyState } from "./page";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "جدیدترین" },
  { value: "oldest", label: "قدیمی‌ترین" },
  { value: "price-asc", label: "قیمت: کم به زیاد" },
  { value: "price-desc", label: "قیمت: زیاد به کم" },
  { value: "qty-asc", label: "موجودی: کم به زیاد" },
  { value: "qty-desc", label: "موجودی: زیاد به کم" },
  { value: "name", label: "نام" },
];

const SORT_VALUES = new Set(SORT_OPTIONS.map((o) => o.value));
const AVAILABILITY_VALUES: ProductFilter["availability"][] = ["all", "available", "unavailable"];

function isSortKey(value: string | null): value is SortKey {
  return value !== null && SORT_VALUES.has(value as SortKey);
}

function isAvailability(value: string | null): value is ProductFilter["availability"] {
  return value !== null && (AVAILABILITY_VALUES as string[]).includes(value);
}

function filterFromRoute(route: Route): ProductFilter {
  const rawQ = route.query.get("q") ?? "";
  return {
    q: rawQ.slice(0, 200),
    category: (route.query.get("cat") ?? "").slice(0, 100),
    availability: isAvailability(route.query.get("status")) ? (route.query.get("status") as ProductFilter["availability"]) : "all",
    sort: isSortKey(route.query.get("sort")) ? (route.query.get("sort") as SortKey) : "newest",
  };
}

export function renderProducts(container: HTMLElement, route: Route): PageCleanup {
  let filter = filterFromRoute(route);

  const searchInput = input("search", { value: filter.q, placeholder: "جستجو در نام، برند یا دسته‌بندی...", autocomplete: "off" });
  const categorySelect = h("select", { attrs: { "aria-label": "فیلتر دسته‌بندی" } });
  const statusSelect = select({}, [
    { value: "all", label: "همه وضعیت‌ها" },
    { value: "available", label: "موجود" },
    { value: "unavailable", label: "ناموجود" },
  ]);
  const sortSelect = select({}, SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label })));

  const header = pageHeader(
    "محصولات",
    h("a", { class: "btn btn-primary", attrs: { href: "#/add" }, text: "＋ افزودن محصول" }),
    "مدیریت کالاهای انبار",
  );
  const filterBar = h(
    "div",
    { class: "filter-bar" },
    h("div", { class: "filter-search" }, searchInput),
    h("label", { class: "filter-select", attrs: { "aria-label": "دسته‌بندی" } }, categorySelect),
    statusSelect,
    sortSelect,
  );
  const grid = h("div", { class: "products-grid", attrs: { "aria-live": "polite" } });
  const countLine = h("p", { class: "meta-line" });

  container.append(header, filterBar, countLine, grid);

  async function load(): Promise<void> {
    const [products, categories] = await Promise.all([productRepository.findAll(), productRepository.categories()]);
    applyCategories(categories);
    const filtered = filterProducts(products, filter);
    clear(grid);

    countLine.textContent = `نمایش ${filtered.length} محصول`;

    if (filtered.length === 0) {
      grid.appendChild(
        emptyState(
          "🔎",
          "محصولی یافت نشد",
          products.length === 0 ? "هنوز محصولی ثبت نشده است." : "فیلترها را تغییر دهید یا عبارت جستجو را اصلاح کنید.",
          products.length === 0
            ? h("a", { class: "btn btn-primary", attrs: { href: "#/add" }, text: "افزودن محصول" })
            : null,
        ),
      );
      return;
    }

    for (const product of filtered) {
      const linkWrap = h("a", { class: "product-card-link", attrs: { href: `#/product/${product.id}`, "aria-label": `مشاهدهٔ ${product.name}` } });
      linkWrap.appendChild(ProductCard(product));
      grid.appendChild(linkWrap);
    }
  }

  function applyCategories(categories: string[]): void {
    clear(categorySelect);
    categorySelect.appendChild(h("option", { attrs: { value: "" }, text: "همه دسته‌بندی‌ها" }));
    for (const cat of categories) {
      categorySelect.appendChild(h("option", { attrs: { value: cat }, text: cat }));
    }
    categorySelect.value = filter.category || "";
  }

  function applyFromRoute(): void {
    filter = filterFromRoute(route);
    searchInput.value = filter.q;
    statusSelect.value = filter.availability;
    sortSelect.value = filter.sort;
    load().catch(console.error);
  }

  function syncFilters(): void {
    const query: Record<string, string> = {};
    if (filter.q) query.q = filter.q;
    if (filter.category) query.cat = filter.category;
    if (filter.availability !== "all") query.status = filter.availability;
    if (filter.sort !== "newest") query.sort = filter.sort;
    const base = "#/products";
    const q = new URLSearchParams(query).toString();
    if (window.location.hash !== base + (q ? `?${q}` : "")) {
      navigate(base + (q ? `?${q}` : ""));
    }
    load().catch(console.error);
  }

  let searchTimer: number | undefined;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      filter.q = searchInput.value.trim();
      syncFilters();
    }, 250);
  });
  categorySelect.addEventListener("change", () => {
    filter.category = categorySelect.value;
    syncFilters();
  });
  statusSelect.addEventListener("change", () => {
    filter.availability = statusSelect.value as ProductFilter["availability"];
    syncFilters();
  });
  sortSelect.addEventListener("change", () => {
    filter.sort = sortSelect.value as SortKey;
    syncFilters();
  });

  const handleHash = () => {
    const current = window.location.hash;
    if (current.startsWith("#/products")) applyFromRoute();
  };

  window.addEventListener("hashchange", handleHash);
  const off = onDataChanged(load);
  void load();

  return () => {
    off();
    window.removeEventListener("hashchange", handleHash);
    window.clearTimeout(searchTimer);
  };
}