import { clear, h, input, select } from "../app/dom";
import type { PageCleanup } from "../app/App";
import type { Route } from "../app/router";
import { navigate } from "../app/router";
import { onDataChanged, notifyDataChanged } from "../app/events";
import { toast } from "../app/toast";
import { openModal } from "../app/modal";
import { ProductCard } from "../components/ProductCard";
import { productRepository, filterProducts, type ProductFilter, type SortKey } from "../db/ProductRepository";
import { pageHeader, emptyState } from "./page";
import { parseNumericInput } from "../models/product";
import type { Product } from "../models/types";
import { buildXlsx, downloadBlob } from "../utils/xlsx";
import { formatNumber, toFaDigits } from "../utils/format";

const PRICE_FIELDS = [
  { value: "sellingPrice", label: "قیمت فروش" },
  { value: "listPrice", label: "قیمت لیستی / عمده" },
  { value: "purchasePrice", label: "قیمت خرید" },
] as const;

type PriceField = (typeof PRICE_FIELDS)[number]["value"];

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
  let allProducts: Product[] = [];

  const searchInput = input("search", { value: filter.q, placeholder: "جستجو در نام، برند یا دسته‌بندی...", autocomplete: "off" });
  const categorySelect = h("select", { attrs: { "aria-label": "فیلتر دسته‌بندی" } });
  const statusSelect = select({}, [
    { value: "all", label: "همه وضعیت‌ها" },
    { value: "available", label: "موجود" },
    { value: "unavailable", label: "ناموجود" },
  ]);
  const sortSelect = select({}, SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label })));

  const exportBtn = h("button", { class: "btn btn-ghost", attrs: { type: "button" }, text: "خروجی اکسل" });
  const raisePriceBtn = h("button", { class: "btn btn-ghost", attrs: { type: "button" }, text: "افزایش قیمت" });
  const header = pageHeader(
    "محصولات",
    h(
      "div",
      { class: "page-actions" },
      exportBtn,
      raisePriceBtn,
      h("a", { class: "btn btn-primary", attrs: { href: "#/add" }, text: "＋ افزودن محصول" }),
    ),
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
    allProducts = products;
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

  function exportExcel(): void {
    if (allProducts.length === 0) {
      toast("هیچ محصولی برای خروجی وجود ندارد.", "info");
      return;
    }
    const rows: (string | number | null)[][] = [
      ["ردیف", "نام کالا", "نوع (دسته‌بندی)", "برند", "قیمت فروش (تومان)", "موجودی"],
    ];
    allProducts.forEach((p, index) => {
      rows.push([
        index + 1,
        p.name,
        p.category,
        p.brand,
        typeof p.sellingPrice === "number" ? p.sellingPrice : null,
        p.quantity,
      ]);
    });
    const blob = buildXlsx(rows);
    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    downloadBlob(blob, `anbar-products-${stamp}.xlsx`);
    toast(`خروجی اکسل ${allProducts.length} محصول آماده شد.`, "success");
  }

  function openPriceDialog(): void {
    const list = allProducts;
    if (list.length === 0) {
      toast("هیچ محصولی برای تغییر قیمت وجود ندارد.", "info");
      return;
    }

    const fieldSelect = select({}, PRICE_FIELDS.map((f) => ({ value: f.value, label: f.label })));
    fieldSelect.classList.add("price-field-select");
    const percentInput = input("text", { value: "10", placeholder: "درصد", inputmode: "numeric", autocomplete: "off" });
    const summary = h("p", { class: "modal-hint", text: `تعداد انتخاب: ${toFaDigits(String(list.length))}` });

    const allBox = input("checkbox", {});
    allBox.checked = true;
    const selectAll = h("label", { class: "pick-row pick-all" }, allBox, h("span", { text: "انتخاب همه" }));

    const listBox = h("div", { class: "pick-list" });
    const checks = new Map<number, HTMLInputElement>();
    for (const p of list) {
      const cb = input("checkbox", {});
      cb.checked = true;
      checks.set(p.id, cb);
      const price = p.sellingPrice;
      listBox.appendChild(
        h(
          "label",
          { class: "pick-row" },
          cb,
          h("span", { class: "pick-name", text: p.name }),
          h("span", { class: "pick-price", text: price != null ? `${toFaDigits(formatNumber(price))} تومان` : "—" }),
        ),
      );
    }

    function refreshSummary(): void {
      let n = 0;
      checks.forEach((cb) => {
        if (cb.checked) n++;
      });
      summary.textContent = `تعداد انتخاب: ${toFaDigits(String(n))}`;
    }
    allBox.addEventListener("change", () => {
      const state = allBox.checked;
      checks.forEach((cb) => {
        cb.checked = state;
      });
      refreshSummary();
    });
    checks.forEach((cb) => cb.addEventListener("change", refreshSummary));

    const content = h(
      "div",
      { class: "price-dialog" },
      h("p", { class: "modal-hint", text: "عدد مثبت یعنی افزایش و عدد منفی یعنی کاهش قیمت؛ روی محصولاتِ انتخاب‌شده اعمال می‌شود." }),
      h(
        "div",
        { class: "price-controls" },
        h("div", { class: "field" }, h("label", { class: "field-label", text: "کدام قیمت؟" }), fieldSelect),
        h("div", { class: "field" }, h("label", { class: "field-label", text: "درصد تغییر" }), percentInput),
      ),
      selectAll,
      listBox,
      summary,
    );

    const cancelBtn = h("button", { class: "btn", attrs: { type: "button" }, text: "لغو" });
    const applyBtn = h("button", { class: "btn btn-primary", attrs: { type: "button" }, text: "اعمال تغییر قیمت" });
    const actions = h("div", { class: "modal-actions" }, cancelBtn, applyBtn);

    const modal = openModal({ title: "افزایش قیمت محصولات", content, actions });

    cancelBtn.addEventListener("click", modal.close);
    applyBtn.addEventListener("click", async () => {
      const pct = parseNumericInput(percentInput.value);
      if (pct === null) {
        toast("درصد را به‌صورت عدد وارد کنید.", "error");
        return;
      }
      const ids: number[] = [];
      checks.forEach((cb, id) => {
        if (cb.checked) ids.push(id);
      });
      if (ids.length === 0) {
        toast("حداقل یک محصول را انتخاب کنید.", "error");
        return;
      }
      const field = fieldSelect.value as PriceField;
      try {
        const changed = await productRepository.changePrices(ids, field, pct);
        modal.close();
        notifyDataChanged();
        toast(`قیمت ${toFaDigits(String(changed))} محصول تغییر کرد.`, changed > 0 ? "success" : "info");
      } catch (err) {
        console.error("[anbar] خطای تغییر قیمت:", err);
        toast("اعمال تغییر قیمت با مشکل مواجه شد.", "error");
      }
    });
  }

  exportBtn.addEventListener("click", exportExcel);
  raisePriceBtn.addEventListener("click", openPriceDialog);

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